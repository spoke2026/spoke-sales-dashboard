const { test, expect } = require('@playwright/test')

// KPI manual entry, engine wiring, window selector and person scorecard
// (Phase 3a). Runs against a local production build (npm run build && npm run
// start) or a Vercel preview pointed at the shared Supabase project. No
// credentials are stored here.
//
//   E2E_BASE_URL            required
//   E2E_ADMIN_EMAIL         required — edward@spoke.nz
//   E2E_ADMIN_PASSWORD      required
//   E2E_STAFF_EMAIL         required — zz.test.staff@spoke.nz
//   E2E_STAFF_PASSWORD      required
//   E2E_MANAGER_EMAIL       required — zz.test.manager@spoke.nz
//   E2E_MANAGER_PASSWORD    required
//   E2E_SUPABASE_URL        required
//   E2E_SUPABASE_ANON_KEY   required
//
// Every person this spec creates is named "ZZ Test ...". supabase/verify/
// 0006_remove_test_rows.sql, then 0005, 0004, and 0003, remove them.

const BASE_URL = process.env.E2E_BASE_URL
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL
const MANAGER_PASSWORD = process.env.E2E_MANAGER_PASSWORD
const SUPABASE_URL = process.env.E2E_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY

const HAVE_ALL = Boolean(
  BASE_URL && ADMIN_EMAIL && ADMIN_PASSWORD && STAFF_EMAIL && STAFF_PASSWORD &&
  MANAGER_EMAIL && MANAGER_PASSWORD && SUPABASE_URL && SUPABASE_ANON_KEY
)
const SKIP_REASON =
  'E2E_BASE_URL, E2E_ADMIN_EMAIL/PASSWORD, E2E_STAFF_EMAIL/PASSWORD, E2E_MANAGER_EMAIL/PASSWORD ' +
  'and E2E_SUPABASE_URL/ANON_KEY must all be set'

const NAMES = {
  staff: 'ZZ Test staff',
  manager: 'ZZ Test manager',
  other: 'ZZ Test other',
}

// ── Date helpers, independent of lib/kpi (a test proves the app, not itself) ─
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  const dow = new Date(ms).getUTCDay()
  const diff = dow === 0 ? 6 : dow - 1
  return new Date(ms - diff * 86400000).toISOString().slice(0, 10)
}
function addDaysStr(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + n * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}
function nzDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 24 * 3600 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(d)
}
function formatDayMonth(dateStr) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]}`
}
function formatDayMonthYear(dateStr) {
  return `${formatDayMonth(dateStr)} ${dateStr.slice(0, 4)}`
}
function formatLongDate(dateStr) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

function trackConsoleErrors(page) {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

async function login(page, email, password) {
  await page.context().clearCookies()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })
}

// ── Direct Supabase auth + REST, independent of the app's cookies ──────────
async function getAccessToken(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`login failed for ${email}: ${JSON.stringify(json)}`)
  return json.access_token
}

async function restRpc(token, fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(args || {}),
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

async function restSelect(token, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
    },
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

async function restPatch(token, table, query, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

async function restPost(token, table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

async function restDelete(token, table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: token ? `Bearer ${token}` : `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'return=representation',
    },
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, json }
}

// ── Admin API setup helpers (through the app, using the admin's cookies) ───
async function createPerson(page, { fullName, email, managerId, scorecardType }) {
  const res = await page.request.post(`${BASE_URL}/api/kpi/people`, {
    data: {
      fullName,
      email: email ?? '',
      primaryTeamId: null,
      managerId: managerId ?? null,
      isContractor: false,
      scorecardType: scorecardType ?? 'individual',
    },
  })
  const json = await res.json()
  if (res.status() !== 201) throw new Error(`createPerson ${fullName} failed: ${JSON.stringify(json)}`)
  return json.person
}

async function linkPerson(page, person, email) {
  const res = await page.request.patch(`${BASE_URL}/api/kpi/people`, {
    data: {
      id: person.id,
      fullName: person.full_name,
      email,
      primaryTeamId: null,
      managerId: person.manager_id ?? null,
      isContractor: false,
      scorecardType: person.scorecard_type ?? 'individual',
      active: true,
    },
  })
  expect(res.status()).toBe(200)
}

async function createDefinition(page, def) {
  const res = await page.request.post(`${BASE_URL}/api/kpi/definitions`, {
    data: {
      name: def.name,
      description: 'A ZZ Test KPI created by the kpi-entry Playwright spec.',
      kpiType: def.kpiType,
      unit: def.unit,
      direction: def.direction,
      aggregation: def.aggregation,
      phasing: def.phasing,
      source: def.source,
      sourceMapping: '',
      attributionMethod: def.attributionMethod,
      attributionNote: '',
      exampleTarget: '',
    },
  })
  const json = await res.json()
  if (res.status() !== 201) throw new Error(`createDefinition ${def.name} failed: ${JSON.stringify(json)}`)
  return json.definition
}

async function publish(page, definition) {
  const res = await page.request.patch(`${BASE_URL}/api/kpi/definitions/status`, {
    data: { id: definition.id, version: definition.version, status: 'published' },
  })
  const json = await res.json()
  if (res.status() !== 200) throw new Error(`publish ${definition.name} failed: ${JSON.stringify(json)}`)
  return json.definition
}

// Builds a locked scorecard for a past or current/future quarter through
// direct REST as the admin (D19): the app's own POST /api/kpi/scorecards only
// allows the current quarter or later, so past-quarter test data goes in this
// test-only way. Every value is confirmed against the database, never assumed.
async function buildLockedScorecardByRest(adminToken, { personId, fy, quarter, kpis, targetsByKpi }) {
  const { status: scStatus, json: scRows } = await restPost(adminToken, 'kpi_scorecard', { person_id: personId, fy, quarter })
  if (scStatus !== 201 || !Array.isArray(scRows) || scRows.length !== 1) {
    throw new Error(`create scorecard failed: ${scStatus} ${JSON.stringify(scRows)}`)
  }
  const scorecardId = scRows[0].id

  const assignmentRows = kpis.map((k, i) => ({
    scorecard_id: scorecardId, kpi_definition_id: k.id, kpi_version: k.version, sort_order: i,
  }))
  const { status: asStatus, json: asRows } = await restPost(adminToken, 'kpi_assignment', assignmentRows)
  if (asStatus !== 201) throw new Error(`create assignments failed: ${asStatus} ${JSON.stringify(asRows)}`)

  const assignmentIdByKpi = new Map(kpis.map((k, i) => [k.name, asRows[i].id]))

  const targetRows = []
  for (const k of kpis) {
    const months = targetsByKpi[k.name]
    for (const [month, value] of Object.entries(months)) {
      targetRows.push({ assignment_id: assignmentIdByKpi.get(k.name), month, value })
    }
  }
  const { status: tgStatus, json: tgRows } = await restPost(adminToken, 'kpi_target', targetRows)
  if (tgStatus !== 201) throw new Error(`create targets failed: ${tgStatus} ${JSON.stringify(tgRows)}`)

  const { status: subStatus, json: subJson } = await restPatch(adminToken, 'kpi_scorecard', `id=eq.${scorecardId}`, { status: 'submitted' })
  if (subStatus !== 200 && subStatus !== 204) throw new Error(`submit failed: ${subStatus} ${JSON.stringify(subJson)}`)

  const { status: lockStatus, json: lockJson } = await restPatch(adminToken, 'kpi_scorecard', `id=eq.${scorecardId}`, { status: 'locked', approval_kind: 'standard' })
  if (lockStatus !== 200 && lockStatus !== 204) throw new Error(`lock failed: ${lockStatus} ${JSON.stringify(lockJson)}`)

  return { scorecardId, assignmentIdByKpi }
}

test.describe.serial('KPI manual entry, engine wiring and window selector (Phase 3a)', () => {
  test.skip(!HAVE_ALL, SKIP_REASON)

  let staffId, managerId, otherId
  let countKpi, hoursKpi, rateKpi, autoKpi
  let adminToken
  let today
  let D, E // D: latest working day within the last 7 days; E: today - 8

  test('setup: admin is linked, ZZ Test rows are clear, and the calendar precondition holds', async ({ page }) => {
    adminToken = await getAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD)
    const { json: personId } = await restRpc(adminToken, 'kpi_my_person_id', {})
    if (personId === null) {
      throw new Error('Add yourself on People and teams with email edward@spoke.nz before running this spec.')
    }

    const existing = await restSelect(adminToken, 'kpi_person', `full_name=like.ZZ Test*&select=id`)
    if (Array.isArray(existing.json) && existing.json.length > 0) {
      throw new Error('Run the 0006, 0005, 0004, and 0003 cleanup scripts before re-running this spec.')
    }

    const wdCounts = await restSelect(
      adminToken, 'kpi_calendar_day',
      'date=gte.2025-10-01&date=lte.2026-03-31&is_working_day=eq.true&select=date,month'
    )
    const counts = new Map()
    for (const r of wdCounts.json) counts.set(r.month, (counts.get(r.month) ?? 0) + 1)
    const expected = { '2025-10-01': 22, '2025-11-01': 20, '2025-12-01': 21, '2026-01-01': 20, '2026-02-01': 19, '2026-03-01': 22 }
    const mismatch = Object.entries(expected).some(([month, n]) => counts.get(month) !== n)

    const mar307 = await restSelect(adminToken, 'kpi_calendar_day', 'date=in.(2026-03-03,2026-03-10,2026-03-07)&select=date,is_working_day')
    const flagByDate = new Map(mar307.json.map(r => [r.date, r.is_working_day]))
    const marMismatch = flagByDate.get('2026-03-03') !== true || flagByDate.get('2026-03-10') !== true || flagByDate.get('2026-03-07') !== false

    if (mismatch || marMismatch) {
      throw new Error("The working-day calendar for October 2025 to March 2026 doesn't match this spec's arithmetic. Check company closures in that range.")
    }

    today = nzDate(0)
    const dRes = await restSelect(
      adminToken, 'kpi_calendar_day',
      `date=gte.${addDaysStr(today, -7)}&date=lte.${addDaysStr(today, -1)}&is_working_day=eq.true&select=date&order=date.desc&limit=1`
    )
    D = dRes.json[0].date
    E = addDaysStr(today, -8)
  })

  test('setup: admin creates ZZ Test people, KPIs, and links the staff and manager logins', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    const manager = await createPerson(page, { fullName: NAMES.manager })
    managerId = manager.id
    await linkPerson(page, manager, MANAGER_EMAIL)

    const staff = await createPerson(page, { fullName: NAMES.staff, managerId })
    staffId = staff.id
    await linkPerson(page, { ...staff, manager_id: managerId }, STAFF_EMAIL)

    const other = await createPerson(page, { fullName: NAMES.other })
    otherId = other.id

    countKpi = await publish(page, await createDefinition(page, {
      name: 'ZZ Test entry count', kpiType: 'lead', unit: 'count', direction: 'higher',
      aggregation: 'sum', phasing: 'working_days', source: 'manual', attributionMethod: 'entered_for_person',
    }))
    hoursKpi = await publish(page, await createDefinition(page, {
      name: 'ZZ Test entry hours', kpiType: 'lead', unit: 'hours', direction: 'lower',
      aggregation: 'average', phasing: 'working_days', source: 'manual', attributionMethod: 'entered_for_person',
    }))
    rateKpi = await publish(page, await createDefinition(page, {
      name: 'ZZ Test entry rate', kpiType: 'lead', unit: 'percent', direction: 'higher',
      aggregation: 'ratio', phasing: 'working_days', source: 'manual', attributionMethod: 'entered_for_person',
    }))
    autoKpi = await publish(page, await createDefinition(page, {
      name: 'ZZ Test automated', kpiType: 'lag', unit: 'count', direction: 'higher',
      aggregation: 'sum', phasing: 'calendar_days', source: 'hubspot', attributionMethod: 'record_owner',
    }))
  })

  test('setup: builds the FY26 Q3 and FY26 Q4 locked scorecards (the acceptance dataset)', async ({ page }) => {
    await buildLockedScorecardByRest(adminToken, {
      personId: staffId, fy: 2026, quarter: 3,
      kpis: [countKpi, hoursKpi],
      targetsByKpi: {
        'ZZ Test entry count': { '2025-10-01': 22, '2025-11-01': 20, '2025-12-01': 21 },
        'ZZ Test entry hours': { '2025-10-01': 24, '2025-11-01': 24, '2025-12-01': 24 },
      },
    })
    await buildLockedScorecardByRest(adminToken, {
      personId: staffId, fy: 2026, quarter: 4,
      kpis: [countKpi, hoursKpi],
      targetsByKpi: {
        'ZZ Test entry count': { '2026-01-01': 20, '2026-02-01': 19, '2026-03-01': 22 },
        'ZZ Test entry hours': { '2026-01-01': 24, '2026-02-01': 24, '2026-03-01': 24 },
      },
    })
  })

  test('setup: builds the previous-quarter (FY27 Q1) locked scorecard via REST', async ({ page }) => {
    await buildLockedScorecardByRest(adminToken, {
      personId: staffId, fy: 2027, quarter: 1,
      kpis: [countKpi, hoursKpi, rateKpi, autoKpi],
      targetsByKpi: {
        'ZZ Test entry count': { '2026-04-01': 20, '2026-05-01': 20, '2026-06-01': 20 },
        'ZZ Test entry hours': { '2026-04-01': 24, '2026-05-01': 24, '2026-06-01': 24 },
        'ZZ Test entry rate': { '2026-04-01': 0.33, '2026-05-01': 0.33, '2026-06-01': 0.33 },
        'ZZ Test automated': { '2026-04-01': 10, '2026-05-01': 10, '2026-06-01': 10 },
      },
    })
  })

  test('setup: builds the current-quarter (FY27 Q2) locked scorecard through the app', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const res = await page.request.post(`${BASE_URL}/api/kpi/scorecards`, { data: { personId: staffId, fy: 2027, quarter: 2 } })
    expect(res.status()).toBe(201)
    const scorecardId = (await res.json()).scorecard.id

    for (const kpi of [countKpi, hoursKpi, rateKpi, autoKpi]) {
      const assignRes = await page.request.post(`${BASE_URL}/api/kpi/assignments`, {
        data: { scorecardId, kpiId: kpi.id, expectedStatus: 'draft' },
      })
      expect(assignRes.status()).toBe(201)
    }

    const { json: assignments } = await restSelect(adminToken, 'kpi_assignment', `scorecard_id=eq.${scorecardId}&select=id,kpi_definition_id`)
    const assignmentIdByKpi = new Map(assignments.map(a => [a.kpi_definition_id, a.id]))

    const cells = []
    for (const month of ['2026-07-01', '2026-08-01', '2026-09-01']) {
      cells.push({ assignmentId: assignmentIdByKpi.get(countKpi.id), month, value: '20' })
      cells.push({ assignmentId: assignmentIdByKpi.get(hoursKpi.id), month, value: '24' })
      cells.push({ assignmentId: assignmentIdByKpi.get(rateKpi.id), month, value: '33' })
      cells.push({ assignmentId: assignmentIdByKpi.get(autoKpi.id), month, value: '10' })
    }
    const targetRes = await page.request.post(`${BASE_URL}/api/kpi/targets`, {
      data: { scorecardId, expectedStatus: 'draft', reason: '', cells },
    })
    expect(targetRes.status()).toBe(200)

    const submitRes = await page.request.patch(`${BASE_URL}/api/kpi/scorecards/status`, {
      data: { id: scorecardId, action: 'submit', expectedStatus: 'draft', note: '', boardMeetingDate: '' },
    })
    expect(submitRes.status()).toBe(200)
    const approveRes = await page.request.patch(`${BASE_URL}/api/kpi/scorecards/status`, {
      data: { id: scorecardId, action: 'approve', expectedStatus: 'submitted', note: '', boardMeetingDate: '' },
    })
    expect(approveRes.status()).toBe(200)
  })

  test('setup: enters the acceptance-dataset actuals through POST /api/kpi/entries as the admin', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    const byWeek = new Map()
    function add(kpiId, date, value) {
      const week = mondayOf(date)
      if (!byWeek.has(week)) byWeek.set(week, [])
      byWeek.get(week).push({ kpiId, date, value: String(value), outOf: '' })
    }

    for (const [date, value] of [
      ['2025-10-31', 30], ['2025-11-28', 20], ['2025-12-23', 21], ['2026-01-30', 20], ['2026-02-27', 15],
      ['2026-03-02', 1], ['2026-03-03', 1], ['2026-03-04', 1], ['2026-03-05', 1], ['2026-03-06', 0],
      ['2026-03-13', 10], ['2026-03-31', 8],
    ]) add(countKpi.id, date, value)

    for (const [date, value] of [
      ['2025-10-15', 60], ['2025-11-17', 60], ['2026-01-20', 10], ['2026-02-10', 10],
      ['2026-03-02', 20], ['2026-03-03', 30], ['2026-03-04', 20], ['2026-03-16', 30], ['2026-03-17', 30], ['2026-03-18', 30],
    ]) add(hoursKpi.id, date, value)

    for (const [weekStart, cells] of byWeek) {
      const res = await page.request.post(`${BASE_URL}/api/kpi/entries`, { data: { personId: staffId, weekStart, cells } })
      if (res.status() !== 200) {
        throw new Error(`entries save failed for week ${weekStart}: ${res.status()} ${JSON.stringify(await res.json().catch(() => null))}`)
      }
    }
  })

  // ── PRD ACCEPTANCE, LIVE ───────────────────────────────────────────────
  const ACCEPTANCE_TABLE = [
    { window: 'range&from=2026-03-03&to=2026-03-03', count: ['1', '1', '1', '0', 'GREEN'], hours: ['30 hours', '24 hours', '24 hours', '+6 hours', 'RED'] },
    { window: 'range&from=2026-03-10&to=2026-03-10', count: ['0', '1', '1', '−1', 'RED'], hours: ['No data', '24 hours', '24 hours', 'No data', 'RED'] },
    { window: 'range&from=2026-03-07&to=2026-03-07', count: ['0', '0', '0', '0', 'GREEN'], hours: ['No data', '24 hours', '24 hours', 'No data', 'RED'] },
    { window: 'range&from=2026-03-02&to=2026-03-08', count: ['4', '5', '5', '−1', 'RED'], hours: ['23.33 hours', '24 hours', '24 hours', '−0.67 hours', 'GREEN'] },
    { window: 'm-2026-03', count: ['22', '22', '22', '0', 'GREEN'], hours: ['26.67 hours', '24 hours', '24 hours', '+2.67 hours', 'RED'] },
    { window: 'q-2026-4', count: ['57', '61', '61', '−4', 'RED'], hours: ['22.5 hours', '24 hours', '24 hours', '−1.5 hours', 'GREEN'] },
    { window: 'q-2026-3', count: ['71', '63', '63', '+8', 'GREEN'], hours: ['60 hours', '24 hours', '24 hours', '+36 hours', 'RED'] },
    { window: 'fy-2026', count: ['128', '124', '124', '+4', 'GREEN'], hours: ['30 hours', '24 hours', '24 hours', '+6 hours', 'RED'] },
  ]

  async function checkCard(page, name, [actual, toDate, full, variance, status]) {
    const card = page.locator('article', { has: page.getByRole('heading', { level: 3, name, exact: true }) })
    await expect(card).toBeVisible()
    const badge = card.locator('p', { hasText: 'Status:' })
    await expect(badge).toContainText(status === 'GREEN' ? 'On target' : 'Off target')
    const bg = await badge.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(bg).toBe(status === 'GREEN' ? 'rgb(82, 118, 93)' : 'rgb(155, 74, 67)')
    await expect(card.getByText('Actual', { exact: true })).toBeVisible()
    const dl = card.locator('dl')
    await expect(dl).toContainText(actual)
    await expect(dl).toContainText(toDate)
    await expect(dl).toContainText(full)
    await expect(dl).toContainText(variance)
  }

  for (const row of ACCEPTANCE_TABLE) {
    test(`PRD acceptance: ${row.window}`, async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=${row.window}`, { waitUntil: 'networkidle' })
      await checkCard(page, 'ZZ Test entry count', row.count)
      await checkCard(page, 'ZZ Test entry hours', row.hours)
    })
  }

  test('PRD acceptance: FY26 note and Q2 FY26 gap window', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=fy-2026`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Judged from 1 October 2025 to 31 March 2026, the months this KPI has an approved target.').first()).toBeVisible()
    await expect(page.getByRole('note').getByText('Q1 FY26 and Q2 FY26 have no approved scorecard, so this window only judges the months that do.')).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=q-2026-2`, { waitUntil: 'networkidle' })
    await expect(page.locator('article')).toHaveCount(0)
    await expect(page.getByRole('note').getByText("Q2 FY26 has no approved scorecard, so there's nothing to judge for this window.")).toBeVisible()
    await expect(page.getByText('No approved KPIs for this window.')).toBeVisible()
  })

  test('PRD acceptance: history is not rewritten by a locked-target exception edit', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const { json: q4Assignments } = await restSelect(adminToken, 'kpi_scorecard', `person_id=eq.${staffId}&fy=eq.2026&quarter=eq.4&select=id`)
    const q4ScorecardId = q4Assignments[0].id
    await page.goto(`${BASE_URL}/kpis/scorecards/${q4ScorecardId}`, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: 'Change locked targets' }).click()
    const marchCell = page.getByRole('row', { name: /ZZ Test entry count/ }).getByRole('textbox').nth(2)
    await marchCell.fill('30')
    await page.getByLabel('Reason for changing locked targets').fill('ZZ Test history check')
    await page.getByRole('button', { name: 'Save locked targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Locked targets changed. Your reason is saved in the audit log.' })).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=m-2026-03`, { waitUntil: 'networkidle' })
    await checkCard(page, 'ZZ Test entry count', ['22', '22', '22', '0', 'GREEN'])

    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=q-2026-4`, { waitUntil: 'networkidle' })
    await checkCard(page, 'ZZ Test entry count', ['57', '61', '61', '−4', 'RED'])

    const { json: assignRows } = await restSelect(adminToken, 'kpi_assignment', `scorecard_id=eq.${q4ScorecardId}&kpi_definition_id=eq.${countKpi.id}&select=id`)
    const { json: targetRows } = await restSelect(adminToken, 'kpi_target', `assignment_id=eq.${assignRows[0].id}&month=eq.2026-03-01&select=value`)
    expect(targetRows.length).toBe(2)
  })

  // ── MANUAL ENTRY ────────────────────────────────────────────────────────
  test('staff: opens Enter actuals, sees the grid, and no Entering for field', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Enter actuals', exact: true }).click()
    await page.waitForURL(/\/kpis\/entry/)

    await expect(page).toHaveTitle('Enter actuals | Spoke Sales Dashboard')
    await expect(page.getByRole('heading', { level: 1, name: 'Enter actuals', exact: true })).toBeVisible()
    const thisMonday = mondayOf(today)
    await expect(page.getByRole('heading', { level: 2, name: `Week of ${formatDayMonthYear(thisMonday)}`, exact: true })).toBeVisible()
    await expect(page.getByLabel('Entering for', { exact: true })).toHaveCount(0)

    await expect(page.getByText('ZZ Test entry count', { exact: true })).toBeVisible()
    await expect(page.getByText('ZZ Test entry hours', { exact: true })).toBeVisible()
    await expect(page.getByText('ZZ Test entry rate', { exact: true })).toBeVisible()
    await expect(page.getByText('ZZ Test automated', { exact: true })).toHaveCount(0)

    expect(errors).toEqual([])
  })

  test('staff: future days read "Not yet" with no input, and inputs have the right accessible names', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const thisMonday = mondayOf(today)
    await page.goto(`${BASE_URL}/kpis/entry?week=${thisMonday}`, { waitUntil: 'networkidle' })

    const tomorrow = addDaysStr(today, 1)
    if (mondayOf(tomorrow) === thisMonday) {
      await expect(page.getByText('Not yet').first()).toBeVisible()
    }

    const dWeek = mondayOf(D)
    await page.goto(`${BASE_URL}/kpis/entry?week=${dWeek}`, { waitUntil: 'networkidle' })
    const dLabel = formatDayMonth(D)
    await expect(page.getByLabel(`ZZ Test entry count, ${dLabel}`, { exact: true })).toBeVisible()
    await expect(page.getByLabel(`ZZ Test entry hours, ${dLabel}`, { exact: true })).toBeVisible()
    await expect(page.getByLabel(`ZZ Test entry rate, ${dLabel}`, { exact: true })).toBeVisible()
    await expect(page.getByLabel(`ZZ Test entry rate, ${dLabel}, out of`, { exact: true })).toBeVisible()
  })

  test('staff: D is flagged Missing, saves 0 and ratio values, and the flag clears', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const dWeek = mondayOf(D)
    await page.goto(`${BASE_URL}/kpis/entry?week=${dWeek}`, { waitUntil: 'networkidle' })

    const dLabel = formatDayMonth(D)
    const countInput = page.getByLabel(`ZZ Test entry count, ${dLabel}`, { exact: true })
    await expect(countInput).toHaveAttribute('aria-describedby', /missing/)
    await expect(page.getByText('✗ Missing').first()).toBeVisible()
    await expect(page.getByText(/entries? missing this week\./)).toBeVisible()

    await countInput.fill('1')
    await page.getByLabel(`ZZ Test entry hours, ${dLabel}`, { exact: true }).fill('0')
    await page.getByLabel(`ZZ Test entry rate, ${dLabel}`, { exact: true }).fill('3')
    await page.getByLabel(`ZZ Test entry rate, ${dLabel}, out of`, { exact: true }).fill('5')

    const saveBtn = page.getByRole('button', { name: 'Save entries', exact: true })
    await expect(saveBtn).toBeEnabled()
    // The grid sends only the cells whose text changed (the server also skips
    // unchanged ones, so only the request itself can show this, mutation 32).
    const sent = page.waitForRequest(r => r.url().endsWith('/api/kpi/entries') && r.method() === 'POST')
    await saveBtn.click()
    const body = (await sent).postDataJSON()
    expect(body.cells.map(c => `${c.kpiId}:${c.date}:${c.value}:${c.outOf}`).sort()).toEqual([
      `${countKpi.id}:${D}:1:`,
      `${hoursKpi.id}:${D}:0:`,
      `${rateKpi.id}:${D}:3:5`,
    ].sort())
    await expect(page.getByRole('status').filter({ hasText: 'Entries saved.' })).toBeVisible()
    await expect(countInput).not.toHaveAttribute('aria-describedby', /missing/)

    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByLabel(`ZZ Test entry count, ${dLabel}`, { exact: true })).toHaveValue('1')
    await expect(page.getByLabel(`ZZ Test entry hours, ${dLabel}`, { exact: true })).toHaveValue('0')
    await expect(page.getByLabel(`ZZ Test entry rate, ${dLabel}`, { exact: true })).toHaveValue('3')
    await expect(page.getByLabel(`ZZ Test entry rate, ${dLabel}, out of`, { exact: true })).toHaveValue('5')

    const { json: hoursActual } = await restSelect(adminToken, 'kpi_actual_daily', `person_id=eq.${staffId}&kpi_definition_id=eq.${hoursKpi.id}&date=eq.${D}&select=value,numerator,denominator,source`)
    expect(hoursActual[0]).toMatchObject({ value: 0, numerator: 0, denominator: 1, source: 'manual' })
    const { json: rateActual } = await restSelect(adminToken, 'kpi_actual_daily', `person_id=eq.${staffId}&kpi_definition_id=eq.${rateKpi.id}&date=eq.${D}&select=value,numerator,denominator,source`)
    expect(rateActual[0]).toMatchObject({ value: null, numerator: 3, denominator: 5, source: 'manual' })

    const { json: hoursEntry } = await restSelect(adminToken, 'kpi_manual_entry', `person_id=eq.${staffId}&kpi_definition_id=eq.${hoursKpi.id}&date=eq.${D}&select=value,numerator,denominator`)
    expect(hoursEntry[0]).toMatchObject({ value: 0, numerator: 0, denominator: 1 })
  })

  test('staff: Save entries is disabled when clean, and a no-op resave is refused', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const dWeek = mondayOf(D)
    await page.goto(`${BASE_URL}/kpis/entry?week=${dWeek}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: 'Save entries', exact: true })).toBeDisabled()

    const { json: before } = await restSelect(adminToken, 'kpi_audit_log', `entity=eq.kpi_manual_entry&order=at.desc&limit=1&select=at`)
    const res = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: staffId, weekStart: dWeek, cells: [
        { kpiId: countKpi.id, date: D, value: '1.0', outOf: '' },
        { kpiId: rateKpi.id, date: D, value: '3', outOf: '5.0' },
      ] },
    })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'Nothing has changed. Change an entry first.' })
    const { json: after } = await restSelect(adminToken, 'kpi_audit_log', `entity=eq.kpi_manual_entry&order=at.desc&limit=1&select=at`)
    expect(after[0]?.at).toBe(before[0]?.at)
  })

  test('staff: validation errors for a bad number, a clear, and a partial ratio', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const dWeek = mondayOf(D)
    await page.goto(`${BASE_URL}/kpis/entry?week=${dWeek}`, { waitUntil: 'networkidle' })
    const dLabel = formatDayMonth(D)

    const countInput = page.getByLabel(`ZZ Test entry count, ${dLabel}`, { exact: true })
    await countInput.fill('-1')
    await page.getByRole('button', { name: 'Save entries', exact: true }).click()
    await expect(page.getByText('Enter a number of 0 or more, without commas or symbols.')).toBeVisible()
    await expect(countInput).toHaveAttribute('aria-invalid', 'true')
    await expect(countInput).toBeFocused()

    await countInput.fill('')
    await page.getByRole('button', { name: 'Save entries', exact: true }).click()
    await expect(page.getByText("Saved entries can't be cleared. Enter the right number instead.")).toBeVisible()

    await countInput.fill('1')
    const rateInput = page.getByLabel(`ZZ Test entry rate, ${dLabel}`, { exact: true })
    const rateOutOf = page.getByLabel(`ZZ Test entry rate, ${dLabel}, out of`, { exact: true })
    await rateOutOf.fill('')
    await rateInput.fill('7')
    await page.getByRole('button', { name: 'Save entries', exact: true }).click()
    await expect(page.getByText('Enter both numbers, or leave both empty.')).toBeVisible()

    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
  })

  test('staff: dirty week nav is disabled with a helper, and Discard changes restores values', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const dWeek = mondayOf(D)
    await page.goto(`${BASE_URL}/kpis/entry?week=${dWeek}`, { waitUntil: 'networkidle' })
    const dLabel = formatDayMonth(D)
    const countInput = page.getByLabel(`ZZ Test entry count, ${dLabel}`, { exact: true })
    const original = await countInput.inputValue()
    await countInput.fill('99')

    const prevLink = page.getByRole('link', { name: 'Previous week', exact: true })
    await expect(prevLink).toHaveAttribute('aria-disabled', 'true')
    const describedBy = await prevLink.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.locator(`#${describedBy}`)).toHaveText('Save or discard your changes first.')

    const urlBefore = page.url()
    await prevLink.click({ force: true })
    expect(page.url()).toBe(urlBefore)

    await page.getByRole('button', { name: 'Discard changes', exact: true }).click()
    await expect(countInput).toHaveValue(original)
  })

  test('7-day rule: E has no input and shows the closed note, and the API refuses E for the owner', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const eWeek = mondayOf(E)
    await page.goto(`${BASE_URL}/kpis/entry?week=${eWeek}`, { waitUntil: 'networkidle' })
    const eLabel = formatDayMonth(E)

    await expect(page.getByLabel(`ZZ Test entry count, ${eLabel}`, { exact: true })).toHaveCount(0)
    const closedDayLabel = formatDayMonth(addDaysStr(today, -7))
    await expect(page.getByText(new RegExp(`Days before ${closedDayLabel} can only be changed by your line manager or the admin\\.`))).toBeVisible()

    const res = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: staffId, weekStart: eWeek, cells: [{ kpiId: countKpi.id, date: E, value: '5', outOf: '' }] },
    })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: 'Days more than 7 days ago can only be changed by your line manager or the admin.' })
    const { json: writtenCheck } = await restSelect(adminToken, 'kpi_manual_entry', `person_id=eq.${staffId}&kpi_definition_id=eq.${countKpi.id}&date=eq.${E}&select=id`)
    expect(writtenCheck.length).toBe(0)
  })

  test('manager: sees Entering for, saves for staff on E\'s week, and the audit log carries their email', async ({ page }) => {
    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/entry`, { waitUntil: 'networkidle' })
    const select = page.getByLabel('Entering for', { exact: true })
    await expect(select).toBeVisible()
    await expect(select.getByRole('option', { name: NAMES.manager, exact: true })).toHaveCount(1)
    await expect(select.getByRole('option', { name: NAMES.staff, exact: true })).toHaveCount(1)

    await select.selectOption({ label: NAMES.staff })
    await page.getByRole('button', { name: 'Show person', exact: true }).click()
    await page.waitForLoadState('networkidle')

    const eWeek = mondayOf(E)
    await page.goto(`${BASE_URL}/kpis/entry?person=${staffId}&week=${eWeek}`, { waitUntil: 'networkidle' })
    const eLabel = formatDayMonth(E)
    const countInput = page.getByLabel(`ZZ Test entry count, ${eLabel}`, { exact: true })
    await expect(countInput).toBeVisible()
    await countInput.fill('2')
    await page.getByRole('button', { name: 'Save entries', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Entries saved.' })).toBeVisible()

    const { json: auditRows } = await restSelect(
      adminToken, 'kpi_audit_log',
      `entity=eq.kpi_manual_entry&action=eq.insert&order=at.desc&limit=5&select=actor_email,after`
    )
    const match = auditRows.find(r => r.after && r.after.person_id === staffId && r.after.kpi_definition_id === countKpi.id && r.after.date === E)
    expect(match).toBeTruthy()
    expect(match.actor_email).toBe(MANAGER_EMAIL)
  })

  test('manager: POST for a non-report is refused, and the entry page shows the fallback note', async ({ page }) => {
    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    const thisMonday = mondayOf(today)
    const res = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: otherId, weekStart: thisMonday, cells: [{ kpiId: countKpi.id, date: today, value: '1', outOf: '' }] },
    })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: "You can't enter actuals for this person." })

    await page.goto(`${BASE_URL}/kpis/entry?person=${otherId}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('note').getByText("You can't enter actuals for that person, so this shows your own.")).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: `Week of ${formatDayMonthYear(mondayOf(today))}`, exact: true })).toBeVisible()
  })

  test('empty state: a week with no scorecard shows the "no scorecard" note', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/entry?week=2025-04-07`, { waitUntil: 'networkidle' })
    await expect(page.getByText(`${NAMES.staff} has no scorecard covering this week yet.`)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Start one on Scorecards.', exact: true })).toHaveAttribute('href', '/kpis/scorecards')
  })

  // ── PERSON SCORECARD AND WINDOW SELECTOR ───────────────────────────────
  test('person page: title, chips, and "Showing This month"', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}`, { waitUntil: 'networkidle' })
    await expect(page).toHaveTitle('Person scorecard | Spoke Sales Dashboard')
    await expect(page.getByText('Person scorecard', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: NAMES.staff, exact: true })).toBeVisible()
    const monthChip = page.getByRole('link', { name: 'This month', exact: true })
    await expect(monthChip).toHaveAttribute('aria-current', 'true')

    const monthLabel = new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', month: 'long', year: 'numeric' }).format(new Date())
    await expect(page.getByText(`Showing This month, ${monthLabel}`)).toBeVisible()
  })

  test('person page: each chip navigates and marks itself current', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}`, { waitUntil: 'networkidle' })
    for (const [label, param] of [['Today', 'today'], ['This week', 'week'], ['This quarter', 'quarter'], ['This FY', 'fy'], ['This month', null]]) {
      await page.getByRole('link', { name: label, exact: true }).click()
      if (param) {
        await page.waitForURL(new RegExp(`window=${param}$`), { waitUntil: 'commit' })
      } else {
        await page.waitForURL(new RegExp(`/kpis/people/${staffId}$`), { waitUntil: 'commit' })
      }
      await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'true')
    }
  })

  test('person page: custom range form', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}`, { waitUntil: 'networkidle' })
    await page.getByText('Months, quarters, and custom range', { exact: true }).click()
    await page.getByLabel('From', { exact: true }).fill('2026-03-02')
    await page.getByLabel('To', { exact: true }).fill('2026-03-08')
    await page.getByRole('button', { name: 'Show range', exact: true }).click()
    await page.waitForURL(/window=range&from=2026-03-02&to=2026-03-08/)
    await expect(page.getByText('Showing Mon 2 Mar 2026 to Sun 8 Mar 2026')).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=range&from=2026-03-05&to=2026-03-05`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Showing Thu 5 Mar 2026', { exact: false })).toBeVisible()
  })

  const FALLBACK_CASES = [
    { qs: 'window=banana', note: "That window link isn't valid, so this shows this month." },
    { qs: 'window=range&from=2026-03-08&to=2026-03-02', note: 'The custom range starts after it ends, so this shows this month.' },
    { qs: 'window=range&from=2025-04-01&to=2026-04-02', note: 'Custom ranges can be up to 366 days, so this shows this month.' },
    { qs: 'window=range&from=2020-01-01&to=2020-01-02', note: /The working-day calendar covers .+, so this shows this month\./ },
  ]
  for (const c of FALLBACK_CASES) {
    test(`person page: fallback — ${c.qs}`, async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      await page.goto(`${BASE_URL}/kpis/people/${staffId}?${c.qs}`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('note').getByText(c.note)).toBeVisible()
      await expect(page.getByRole('link', { name: 'This month', exact: true })).toHaveAttribute('aria-current', 'true')
    })
  }

  test('person page: a future month falls back with the not-started notice', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const future = addDaysStr(mondayOf(today).slice(0, 7) + '-01', 400).slice(0, 7)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=m-${future}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('note').getByText("That period hasn't started yet, so this shows this month.")).toBeVisible()
  })

  test('person page: not-started months and quarters show disabled text, not links', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}`, { waitUntil: 'networkidle' })
    await page.getByText('Months, quarters, and custom range', { exact: true }).click()

    // A month after the current one (FY27 runs to March) is disabled text, not a link,
    // with the visually hidden "(not started yet)" note.
    const notStartedLinks = page.getByRole('link', { name: /\(not started yet\)/ })
    await expect(notStartedLinks).toHaveCount(0)
    await expect(page.getByText('(not started yet)').first()).toBeVisible()
  })

  test('person page: current-quarter automated KPI shows "Not connected yet" in red', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=quarter`, { waitUntil: 'networkidle' })
    const card = page.locator('article', { has: page.getByRole('heading', { level: 3, name: 'ZZ Test automated', exact: true }) })
    await expect(card.getByText('Off target')).toBeVisible()
    await expect(card.getByText('Not connected yet. This KPI has no data until its data source is connected, so it shows red.')).toBeVisible()
  })

  test('person page: sticky window bar at 1440x900, static at 375x800, and focus not hidden', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${BASE_URL}/kpis/people/${staffId}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.querySelector('[class*="shell"]')?.scrollTo(0, 800))
    await page.waitForTimeout(150)
    const bar = page.locator('nav[aria-label="Choose a window"]')
    const barBox = await bar.boundingBox()
    expect(Math.round(barBox.y)).toBe(0)

    let focused = null
    for (let i = 0; i < 40 && !focused; i++) {
      await page.keyboard.press('Tab')
      focused = await page.evaluate(() => {
        const el = document.activeElement
        if (el && el.tagName === 'A' && el.closest('article')) return el
        return null
      })
    }
    const focusedBox = await page.evaluate(() => {
      const el = document.activeElement
      const r = el.getBoundingClientRect()
      return { top: r.top }
    })
    const barBottom = (await bar.boundingBox()).y + (await bar.boundingBox()).height
    expect(focusedBox.top).toBeGreaterThanOrEqual(barBottom - 1)

    await page.setViewportSize({ width: 375, height: 800 })
    await page.goto(`${BASE_URL}/kpis/people/${staffId}`, { waitUntil: 'networkidle' })
    const position = await bar.evaluate(el => getComputedStyle(el).position)
    expect(position).not.toBe('sticky')
  })

  test('/kpis: shows My scorecard, Enter actuals, the new lede, and name links', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: 'My scorecard', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Enter actuals', exact: true })).toBeVisible()
    await expect(page.getByText('Each KPI shows red or green against its target for the window you choose.')).toBeVisible()
    await expect(page.getByRole('link', { name: NAMES.staff, exact: true })).toHaveAttribute('href', `/kpis/people/${staffId}`)
  })

  // ── SECURITY ────────────────────────────────────────────────────────────
  test('security: no cookie gives 401 JSON, not a redirect', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/kpi/entries`, { data: { personId: staffId, weekStart: mondayOf(today), cells: [] } })
    expect(res.status()).toBe(401)
    expect(await res.json()).toEqual({ error: 'Sign in to continue.' })
  })

  test('security: an extra key, a missing key, and a duplicate cell all give the generic 400 and write nothing', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const week = mondayOf(today)
    const { json: before } = await restSelect(adminToken, 'kpi_manual_entry', `person_id=eq.${staffId}&select=id`)

    const extraKey = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: staffId, weekStart: week, cells: [], kpiVersion: 1 },
    })
    expect(extraKey.status()).toBe(400)
    expect(await extraKey.json()).toEqual({ error: "We couldn't save that. Try again." })

    const missingKey = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: staffId, cells: [] },
    })
    expect(missingKey.status()).toBe(400)

    const dupe = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: staffId, weekStart: week, cells: [
        { kpiId: countKpi.id, date: week, value: '1', outOf: '' },
        { kpiId: countKpi.id, date: week, value: '2', outOf: '' },
      ] },
    })
    expect(dupe.status()).toBe(400)
    expect(await dupe.json()).toEqual({ error: "We couldn't save that. Try again." })

    const { json: after } = await restSelect(adminToken, 'kpi_manual_entry', `person_id=eq.${staffId}&select=id`)
    expect(after.length).toBe(before.length)
  })

  test('security: direct REST as staff — forged actual, delete, and today-8 are all refused; anon reads nothing', async ({ page }) => {
    const staffToken = await getAccessToken(STAFF_EMAIL, STAFF_PASSWORD)

    const forged = await restPost(staffToken, 'kpi_actual_daily', {
      person_id: staffId, kpi_definition_id: countKpi.id, kpi_version: countKpi.version,
      date: today, value: 999, source: 'manual',
    })
    expect(forged.status).toBe(403)
    expect(JSON.stringify(forged.json)).not.toMatch(/relation|column|constraint/i)

    const delRes = await restDelete(staffToken, 'kpi_manual_entry', `person_id=eq.${staffId}&limit=1`)
    expect(Array.isArray(delRes.json) ? delRes.json.length : 0).toBe(0)

    const badDate = await restPost(staffToken, 'kpi_manual_entry', {
      person_id: staffId, kpi_definition_id: countKpi.id, date: E, value: 5,
    })
    expect(badDate.status).toBe(400)
    expect(badDate.json.code).toBe('KS017')

    // Anon gets no rows either because RLS admits none, or (as here) anon has
    // no grant on the table at all — a stricter form of "no data" than an
    // empty array, and not a defect.
    const anonEntries = await restSelect(null, 'kpi_manual_entry', 'select=id&limit=1')
    expect(Array.isArray(anonEntries.json) ? anonEntries.json : []).toEqual([])
    if (!Array.isArray(anonEntries.json)) expect(anonEntries.json.code).toBe('42501')
    const anonActuals = await restSelect(null, 'kpi_actual_daily', 'select=person_id&limit=1')
    expect(Array.isArray(anonActuals.json) ? anonActuals.json : []).toEqual([])
    if (!Array.isArray(anonActuals.json)) expect(anonActuals.json.code).toBe('42501')
  })

  test('security: no response body anywhere contains database text', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const res400 = await page.request.post(`${BASE_URL}/api/kpi/entries`, { data: { personId: staffId, weekStart: mondayOf(today), cells: [], extra: 1 } })
    const res403 = await page.request.post(`${BASE_URL}/api/kpi/entries`, {
      data: { personId: otherId, weekStart: mondayOf(today), cells: [{ kpiId: countKpi.id, date: today, value: '1', outOf: '' }] },
    })
    for (const res of [res400, res403]) {
      const text = JSON.stringify(await res.json())
      expect(text).not.toMatch(/SQLSTATE|constraint|duplicate key|relation "|column "/i)
    }
  })

  // ── ERROR HANDLING ──────────────────────────────────────────────────────
  test('error handling: a non-UUID and a random valid UUID both show Person not found', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/people/not-a-uuid`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Person not found', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to KPIs', exact: true })).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/people/00000000-0000-0000-0000-000000000000`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Person not found', exact: true })).toBeVisible()
  })

  // ── 2b ADVISORY ─────────────────────────────────────────────────────────
  test('2b advisory: the board meeting date max equals the NZ date on a submitted company scorecard', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const { json: companyScorecards } = await restSelect(adminToken, 'kpi_scorecard', 'person_id=is.null&status=eq.submitted&select=id&order=created_at.desc&limit=1')
    if (companyScorecards.length === 0) {
      test.skip(true, 'No submitted company scorecard available locally for this check.')
      return
    }
    await page.goto(`${BASE_URL}/kpis/scorecards/${companyScorecards[0].id}`, { waitUntil: 'networkidle' })
    const opener = page.getByRole('button', { name: 'Record board approval', exact: true })
    if (await opener.count() > 0) {
      await opener.first().click()
      const dateInput = page.getByLabel('Board meeting date', { exact: true })
      await expect(dateInput).toHaveAttribute('max', today)
    }
  })

  // ── REGRESSION: no console errors ──────────────────────────────────────
  // "/" is excluded locally: the dashboard's HubSpot calls 401 against this
  // local stack (no real HubSpot credentials), which is a pre-existing local
  // environment limit on a guardrail file (app/page.js, out of this stream),
  // not a Phase 3a regression. Cole checks "/" live, where it has real
  // credentials, per the POST-BUILD checklist.
  const CONSOLE_CHECK_PAGES = ['/kpis', '/kpis/admin', '/kpis/library', '/kpis/scorecards']
  for (const path of CONSOLE_CHECK_PAGES) {
    test(`regression: no console errors on ${path}`, async ({ page }) => {
      await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
      const errors = trackConsoleErrors(page)
      await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' })
      expect(errors).toEqual([])
    })
  }

  test('regression: no console errors on the person page for every window kind, and on the entry page', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const errors = trackConsoleErrors(page)
    for (const w of ['today', 'week', 'month', 'quarter', 'fy', 'm-2026-03', 'q-2026-4', 'fy-2026', 'range&from=2026-03-02&to=2026-03-08']) {
      await page.goto(`${BASE_URL}/kpis/people/${staffId}?window=${w}`, { waitUntil: 'networkidle' })
    }
    await page.goto(`${BASE_URL}/kpis/entry`, { waitUntil: 'networkidle' })
    expect(errors).toEqual([])
  })
})
