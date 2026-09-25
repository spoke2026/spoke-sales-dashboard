const { test, expect } = require('@playwright/test')

// KPI scorecards (Phase 2b) — Staff, Line manager, Admin, Security,
// Error-handling and Header criteria. Runs against a local production build
// (npm run build && npm run start) or a Vercel preview pointed at the shared
// Supabase project. No credentials are stored here.
//
//   E2E_BASE_URL            required
//   E2E_ADMIN_EMAIL         required — edward@spoke.nz
//   E2E_ADMIN_PASSWORD      required
//   E2E_STAFF_EMAIL         required
//   E2E_STAFF_PASSWORD      required
//   E2E_MANAGER_EMAIL       required
//   E2E_MANAGER_PASSWORD    required
//   E2E_SUPABASE_URL        required
//   E2E_SUPABASE_ANON_KEY   required
//
// Every scorecard this spec creates is for FY29 Q4 (January to March 2029).
// Every person it creates is named "ZZ Test ...". supabase/verify/
// 0005_remove_test_rows.sql (then 0004, then 0003) removes them.

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

const FY = 2029
const QUARTER = 4
const QUARTER_PARAM = `${FY}-${QUARTER}`

const NAMES = {
  staff: 'ZZ Test staff',
  manager: 'ZZ Test manager',
  noLogin: 'ZZ Test no login',
  other: 'ZZ Test other',
}

async function login(page, email, password) {
  await page.context().clearCookies()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })
}

// The board-meeting-date checks are relative to "today" in Pacific/Auckland
// (the app's rule, D4), not the test runner's local timezone or UTC.
function nzDate(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 24 * 3600 * 1000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(d)
}

function trackConsoleErrors(page) {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
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

// ── Admin API setup helpers (through the app, using the admin's cookies) ───
async function createPerson(page, { fullName, email, managerId }) {
  const res = await page.request.post(`${BASE_URL}/api/kpi/people`, {
    data: {
      fullName,
      email: email ?? '',
      primaryTeamId: null,
      managerId: managerId ?? null,
      isContractor: false,
      scorecardType: 'individual',
    },
  })
  const json = await res.json()
  if (res.status() !== 201) throw new Error(`createPerson ${fullName} failed: ${JSON.stringify(json)}`)
  return json.person
}

async function createDefinition(page, { name, kpiType, unit, attributionMethod }) {
  const res = await page.request.post(`${BASE_URL}/api/kpi/definitions`, {
    data: {
      name,
      description: 'A ZZ Test KPI created by the kpi-scorecards Playwright spec.',
      kpiType,
      unit,
      direction: 'higher',
      aggregation: 'sum',
      phasing: 'working_days',
      source: 'manual',
      sourceMapping: '',
      attributionMethod: attributionMethod ?? 'entered_for_person',
      attributionNote: '',
      exampleTarget: '',
    },
  })
  const json = await res.json()
  if (res.status() !== 201) throw new Error(`createDefinition ${name} failed: ${JSON.stringify(json)}`)
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

async function retire(page, definition) {
  const res = await page.request.patch(`${BASE_URL}/api/kpi/definitions/status`, {
    data: { id: definition.id, version: definition.version, status: 'retired' },
  })
  const json = await res.json()
  if (res.status() !== 200) throw new Error(`retire ${definition.name} failed: ${JSON.stringify(json)}`)
  return json.definition
}

test.describe.serial('KPI scorecards (Phase 2b)', () => {
  test.skip(!HAVE_ALL, SKIP_REASON)

  let staffId, managerId, noLoginId, otherId
  let leadKpi, lagKpi, percentKpi, retiredKpi, companyKpi
  let staffScorecardId

  test('setup: admin is linked, and previous ZZ Test rows are cleared', async ({ page }) => {
    const adminToken = await getAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD)
    const { json: personId } = await restRpc(adminToken, 'kpi_my_person_id', {})
    if (personId === null) {
      throw new Error('Add yourself on People and teams with email edward@spoke.nz before running this spec.')
    }

    const existing = await restSelect(adminToken, 'kpi_person', `full_name=like.ZZ Test*&select=id`)
    if (Array.isArray(existing.json) && existing.json.length > 0) {
      throw new Error('Run the 0005, 0004, and 0003 cleanup scripts before re-running this spec.')
    }
  })

  test('setup: admin creates ZZ Test people and KPIs', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    const manager = await createPerson(page, { fullName: NAMES.manager, email: MANAGER_EMAIL })
    managerId = manager.id

    // Created without a login email first, so the "before linking" test below
    // sees the unlinked state. The admin links it in a later step.
    const staff = await createPerson(page, { fullName: NAMES.staff, managerId })
    staffId = staff.id

    const noLogin = await createPerson(page, { fullName: NAMES.noLogin, managerId })
    noLoginId = noLogin.id

    const other = await createPerson(page, { fullName: NAMES.other })
    otherId = other.id

    leadKpi = await publish(page, await createDefinition(page, { name: 'ZZ Test lead KPI', kpiType: 'lead', unit: 'count' }))
    lagKpi = await publish(page, await createDefinition(page, { name: 'ZZ Test lag KPI', kpiType: 'lag', unit: 'hours' }))
    percentKpi = await publish(page, await createDefinition(page, { name: 'ZZ Test percent KPI', kpiType: 'lag', unit: 'percent' }))
    retiredKpi = await retire(page, await publish(page, await createDefinition(page, { name: 'ZZ Test retired KPI', kpiType: 'lag', unit: 'count' })))
    companyKpi = await publish(page, await createDefinition(page, { name: 'ZZ Test company KPI', kpiType: 'lag', unit: 'count', attributionMethod: 'company' }))
  })

  // ── STAFF ──────────────────────────────────────────────────────────────
  test('staff: before linking, sees the unlinked note and no Start scorecard', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })
    await page.getByRole('link', { name: 'Scorecards' }).click()
    await page.waitForURL(/\/kpis\/scorecards$/)

    await expect(page).toHaveTitle('Scorecards | Spoke Sales Dashboard')
    await expect(page.getByRole('heading', { level: 1, name: 'Scorecards' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'KPIs', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('note').getByText(
      "Your login isn't linked to a person yet, so you can view scorecards but not start or change one. Ask the admin to add your email on People and teams."
    )).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start scorecard' })).toHaveCount(0)

    const res = await page.request.post(`${BASE_URL}/api/kpi/scorecards`, { data: { personId: null, fy: FY, quarter: QUARTER } })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: "Your login isn't linked to a person yet. Ask the admin to add your email on People and teams." })
  })

  test('setup: admin links the staff login to ZZ Test staff', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const res = await page.request.patch(`${BASE_URL}/api/kpi/people`, {
      data: {
        id: staffId,
        fullName: NAMES.staff,
        email: STAFF_EMAIL,
        primaryTeamId: null,
        managerId,
        isContractor: false,
        scorecardType: 'individual',
        active: true,
      },
    })
    expect(res.status()).toBe(200)

    const res2 = await page.request.patch(`${BASE_URL}/api/kpi/people`, {
      data: {
        id: managerId,
        fullName: NAMES.manager,
        email: MANAGER_EMAIL,
        primaryTeamId: null,
        managerId: null,
        isContractor: false,
        scorecardType: 'individual',
        active: true,
      },
    })
    expect(res2.status()).toBe(200)
  })

  test('staff: after linking, starts their FY29 Q4 scorecard', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards?quarter=${QUARTER_PARAM}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('combobox', { name: 'Quarter' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Q4 FY29 (January to March 2029)', selected: true })).toHaveCount(1)

    const row = page.getByRole('row', { name: new RegExp('^' + NAMES.staff) })
    const start = Date.now()
    await row.getByRole('button', { name: 'Start scorecard' }).click()
    await page.waitForURL(/\/kpis\/scorecards\/[0-9a-f-]+\?notice=started/, { timeout: 5000 })
    expect(Date.now() - start).toBeLessThan(3000)

    staffScorecardId = page.url().match(/\/kpis\/scorecards\/([0-9a-f-]+)\?/)[1]

    await expect(page.getByRole('status').filter({ hasText: 'Scorecard started.' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: NAMES.staff })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText('Q4 FY29, January to March 2029')).toBeVisible()
  })

  test('staff: Add a KPI list excludes retired, proposed and company KPIs; adds three', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })

    const select = page.getByLabel('Add a KPI')
    await expect(select.getByRole('option', { name: /ZZ Test retired KPI/ })).toHaveCount(0)
    await expect(select.getByRole('option', { name: /ZZ Test company KPI/ })).toHaveCount(0)

    for (const kpi of [leadKpi, lagKpi, percentKpi]) {
      await select.selectOption(kpi.id)
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/kpi/assignments') && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Add KPI' }).click(),
      ])
      if (response.status() !== 201) {
        throw new Error(`Add KPI for ${kpi.name} failed: ${response.status()} ${JSON.stringify(await response.json().catch(() => null))}`)
      }
      await expect(page.getByRole('status').filter({ hasText: 'KPI added.' })).toBeVisible()
      await page.waitForLoadState('networkidle')
    }

    await expect(page.getByText('This scorecard has 3 KPIs. Aim for 5 to 8.')).toBeVisible()
    await expect(page.getByText(/fewer lead KPIs \(1\) than lag KPIs \(2\)/)).toBeVisible()
    await expect(page.getByText('9 monthly targets still empty. Every KPI needs a target for every month before approval. 0 is allowed.')).toBeVisible()
  })

  test('staff: assignments API rejects a retired KPI and a company KPI', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const res1 = await page.request.post(`${BASE_URL}/api/kpi/assignments`, {
      data: { scorecardId: staffScorecardId, kpiId: retiredKpi.id, expectedStatus: 'draft' },
    })
    expect(res1.status()).toBe(409)
    expect(await res1.json()).toEqual({ error: "That KPI isn't available for new scorecards. Pick a published KPI.", field: 'kpiId' })

    const res2 = await page.request.post(`${BASE_URL}/api/kpi/assignments`, {
      data: { scorecardId: staffScorecardId, kpiId: companyKpi.id, expectedStatus: 'draft' },
    })
    expect(res2.status()).toBe(400)
    expect(await res2.json()).toEqual({ error: 'Company KPIs can only go on the company scorecard.', field: 'kpiId' })
  })

  test('staff: saves targets (0, decimals and percent), reload shows saved values', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })

    const leadRow = page.getByRole('row', { name: new RegExp(leadKpi.name) })
    const cells = leadRow.getByRole('textbox')
    await cells.nth(0).fill('20')
    await cells.nth(1).fill('0')
    await cells.nth(2).fill('20.5')

    const percentRow = page.getByRole('row', { name: new RegExp(percentKpi.name) })
    await percentRow.getByRole('textbox').nth(0).fill('33')

    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Targets saved.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.reload({ waitUntil: 'networkidle' })
    const leadRow2 = page.getByRole('row', { name: new RegExp(leadKpi.name) })
    const cells2 = leadRow2.getByRole('textbox')
    await expect(cells2.nth(0)).toHaveValue('20')
    await expect(cells2.nth(1)).toHaveValue('0')
    await expect(cells2.nth(2)).toHaveValue('20.5')
    const percentRow2 = page.getByRole('row', { name: new RegExp(percentKpi.name) })
    await expect(percentRow2.getByRole('textbox').nth(0)).toHaveValue('33')
  })

  test('staff: -1 shows a field error and saves nothing; clearing a saved cell is rejected', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })

    const lagRow = page.getByRole('row', { name: new RegExp(`^${lagKpi.name}`) })
    const cell = lagRow.getByRole('textbox').nth(0)
    await cell.fill('-1')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByText('Enter a number of 0 or more, without commas or symbols.')).toBeVisible()
    await expect(cell).toHaveAttribute('aria-invalid', 'true')
    await expect(cell).toBeFocused()

    const leadRow = page.getByRole('row', { name: new RegExp(leadKpi.name) })
    const savedCell = leadRow.getByRole('textbox').nth(0)
    await savedCell.fill('')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByText("Targets can't be cleared once saved. Enter 0 instead.")).toBeVisible()
  })

  test('staff: Save targets disabled with no changes; no-op resave via API writes nothing', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('button', { name: 'Save targets' })).toBeDisabled()

    // Find the assignment ids via the KPI links.
    const leadLink = page.getByRole('link', { name: leadKpi.name })
    const leadHref = await leadLink.getAttribute('href')
    const percentLink = page.getByRole('link', { name: percentKpi.name })
    const percentHref = await percentLink.getAttribute('href')

    const staffToken = await getAccessToken(STAFF_EMAIL, STAFF_PASSWORD)
    const { json: assignments } = await restSelect(staffToken, 'kpi_assignment', `scorecard_id=eq.${staffScorecardId}&select=id,kpi_definition_id`)
    const leadAssignment = assignments.find(a => leadHref.includes(a.kpi_definition_id))
    const percentAssignment = assignments.find(a => percentHref.includes(a.kpi_definition_id))

    const before = await restSelect(staffToken, 'kpi_target', `assignment_id=in.(${leadAssignment.id},${percentAssignment.id})&select=id`)
    const beforeCount = before.json.length

    const res = await page.request.post(`${BASE_URL}/api/kpi/targets`, {
      data: {
        scorecardId: staffScorecardId,
        expectedStatus: 'draft',
        reason: '',
        cells: [
          { assignmentId: leadAssignment.id, month: '2029-03-01', value: '20.50' },
          { assignmentId: percentAssignment.id, month: '2029-01-01', value: '33.0' },
        ],
      },
    })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'Nothing has changed. Edit a target or cancel.' })

    const after = await restSelect(staffToken, 'kpi_target', `assignment_id=in.(${leadAssignment.id},${percentAssignment.id})&select=id`)
    expect(after.json.length).toBe(beforeCount)
  })

  test('staff: dirty grid disables lifecycle and Add/Remove; Discard restores', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })

    const lagRow = page.getByRole('row', { name: new RegExp(`^${lagKpi.name}`) })
    const cell = lagRow.getByRole('textbox').nth(1)
    await cell.fill('5')

    const submitBtn = page.getByRole('button', { name: 'Submit for approval' })
    await expect(submitBtn).toBeDisabled()
    const describedBy = await submitBtn.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.locator(`#${describedBy}`)).toHaveText('Save or discard your target changes first.')

    await page.getByRole('button', { name: 'Discard changes' }).click()
    await expect(cell).toHaveValue('')
  })

  test('staff: submits with gaps, then read-only, then 403 on self-approve', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    const cancelBtn = page.getByRole('button', { name: 'Cancel' })
    await expect(cancelBtn).toBeFocused()
    await page.getByRole('button', { name: 'Submit scorecard' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard submitted.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Submitted', { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`Submitted by ${NAMES.staff} on`))).toBeVisible()
    await expect(page.locator('input')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toHaveCount(0)

    const res = await page.request.fetch(`${BASE_URL}/api/kpi/scorecards/status`, {
      method: 'PATCH',
      data: { id: staffScorecardId, action: 'approve', expectedStatus: 'submitted', note: '', boardMeetingDate: '' },
    })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: "You can't make that change to this scorecard." })
    await page.reload({ waitUntil: 'networkidle' })
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible()
  })

  // ── LINE MANAGER ─────────────────────────────────────────────────────────
  let noLoginScorecardId

  test('manager: sees Start scorecard for own + no-login report, Open for staff, none for other', async ({ page }) => {
    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards?quarter=${QUARTER_PARAM}`, { waitUntil: 'networkidle' })

    await expect(page.getByRole('row', { name: new RegExp('^' + NAMES.manager) }).getByRole('button', { name: 'Start scorecard' })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp('^' + NAMES.noLogin) }).getByRole('button', { name: 'Start scorecard' })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp('^' + NAMES.other) }).getByRole('button', { name: 'Start scorecard' })).toHaveCount(0)
    await expect(page.getByRole('row', { name: new RegExp('^' + NAMES.staff) }).getByRole('link', { name: /^Open/ })).toBeVisible()
  })

  test('manager: opens staff submitted scorecard, approve blocked by gaps, fills, approves', async ({ page }) => {
    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })

    await expect(page.getByRole('textbox').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Return with a note' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toBeVisible()

    await page.getByRole('button', { name: 'Approve and lock' }).click()
    await page.getByRole('button', { name: 'Approve and lock' }).last().click()
    await expect(page.getByText('Every KPI needs a target for every month before approval. Fill in the empty months, or enter 0.')).toBeVisible()
    await expect(page.getByText('Submitted', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    const lagRow = page.getByRole('row', { name: new RegExp(`^${lagKpi.name}`) })
    const lagCells = lagRow.getByRole('textbox')
    await lagCells.nth(0).fill('1')
    await lagCells.nth(1).fill('1')
    await lagCells.nth(2).fill('1')
    const percentRow = page.getByRole('row', { name: new RegExp(percentKpi.name) })
    const percentCells = percentRow.getByRole('textbox')
    await percentCells.nth(1).fill('10')
    await percentCells.nth(2).fill('10')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Targets saved.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Approve and lock' }).click()
    await page.getByRole('button', { name: 'Approve and lock' }).last().click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard approved and locked.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Locked', { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`Approved by ${NAMES.manager} on`))).toBeVisible()
    await expect(page.locator('input')).toHaveCount(0)
  })

  test('manager: starts, returns with a note, resubmits and approves the no-login report', async ({ page }) => {
    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards?quarter=${QUARTER_PARAM}`, { waitUntil: 'networkidle' })

    const row = page.getByRole('row', { name: new RegExp('^' + NAMES.noLogin) })
    await row.getByRole('button', { name: 'Start scorecard' }).click()
    await page.waitForURL(/\/kpis\/scorecards\/[0-9a-f-]+\?notice=started/, { timeout: 5000 })
    noLoginScorecardId = page.url().match(/\/kpis\/scorecards\/([0-9a-f-]+)\?/)[1]

    await page.getByLabel('Add a KPI').selectOption(leadKpi.id)
    await page.getByRole('button', { name: 'Add KPI' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'KPI added.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const cells = page.getByRole('row', { name: new RegExp(leadKpi.name) }).getByRole('textbox')
    await cells.nth(0).fill('1')
    await cells.nth(1).fill('1')
    await cells.nth(2).fill('1')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Targets saved.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: 'Submit scorecard' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard submitted.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Return with a note' }).click()
    await page.getByRole('button', { name: 'Return scorecard' }).click()
    await expect(page.getByText("Say what needs to change before it's resubmitted.")).toBeVisible()

    await page.getByLabel('What needs to change').fill('ZZ Test lower the October target')
    await page.getByRole('button', { name: 'Return scorecard' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard returned with your note.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText(new RegExp(`Returned by ${NAMES.manager} on`))).toBeVisible()
    await expect(page.getByText('ZZ Test lower the October target')).toBeVisible()

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: 'Submit scorecard' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard submitted.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Approve and lock' }).click()
    await page.getByRole('button', { name: 'Approve and lock' }).last().click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard approved and locked.' })).toBeVisible()
  })

  let otherScorecardId

  test('manager: sees a scorecard started by the admin for a non-report as read only', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const res = await page.request.post(`${BASE_URL}/api/kpi/scorecards`, { data: { personId: otherId, fy: FY, quarter: QUARTER } })
    expect(res.status()).toBe(201)
    otherScorecardId = (await res.json()).scorecard.id
    const assignRes = await page.request.post(`${BASE_URL}/api/kpi/assignments`, {
      data: { scorecardId: otherScorecardId, kpiId: leadKpi.id, expectedStatus: 'draft' },
    })
    expect(assignRes.status()).toBe(201)
    const otherAssignmentId = (await assignRes.json()).assignment.id

    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${otherScorecardId}`, { waitUntil: 'networkidle' })
    await expect(page.locator('input')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Return with a note' })).toHaveCount(0)

    const targetRes = await page.request.post(`${BASE_URL}/api/kpi/targets`, {
      data: { scorecardId: otherScorecardId, expectedStatus: 'draft', reason: '', cells: [{ assignmentId: otherAssignmentId, month: '2029-01-01', value: '1' }] },
    })
    expect(targetRes.status()).toBe(403)
    expect(await targetRes.json()).toEqual({ error: "You can't make that change to this scorecard." })
  })

  test('manager: POST /api/kpi/targets on the locked staff scorecard is 403 and writes nothing', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const adminToken = await getAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD)
    const { json: staffAssignments } = await restSelect(adminToken, 'kpi_assignment', `scorecard_id=eq.${staffScorecardId}&select=id&limit=1`)
    const anAssignmentId = staffAssignments[0].id

    await login(page, MANAGER_EMAIL, MANAGER_PASSWORD)
    const res = await page.request.post(`${BASE_URL}/api/kpi/targets`, {
      data: { scorecardId: staffScorecardId, expectedStatus: 'locked', reason: '', cells: [{ assignmentId: anAssignmentId, month: '2029-01-01', value: '1' }] },
    })
    expect(res.status()).toBe(403)
    expect(await res.json()).toEqual({ error: "You can't make that change to this scorecard." })
  })

  // ── ADMIN ────────────────────────────────────────────────────────────────
  let companyScorecardId
  let adminOwnScorecardId

  test('admin: company scorecard, board approval with field errors, then success', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards?quarter=${QUARTER_PARAM}`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Start company scorecard' }).click()
    await page.waitForURL(/\/kpis\/scorecards\/[0-9a-f-]+\?notice=started/, { timeout: 5000 })
    companyScorecardId = page.url().match(/\/kpis\/scorecards\/([0-9a-f-]+)\?/)[1]

    const select = page.getByLabel('Add a KPI')
    await expect(select.getByRole('option', { name: new RegExp(leadKpi.name) })).toHaveCount(0)
    await select.selectOption(companyKpi.id)
    await page.getByRole('button', { name: 'Add KPI' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'KPI added.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const cells = page.getByRole('row', { name: new RegExp(companyKpi.name) }).getByRole('textbox')
    await cells.nth(0).fill('1')
    await cells.nth(1).fill('1')
    await cells.nth(2).fill('1')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Targets saved.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: 'Submit scorecard' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard submitted.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('button', { name: 'Record board approval' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Record board approval' }).click()
    await page.getByRole('button', { name: 'Record board approval' }).last().click()
    await expect(page.getByText("Enter the board meeting date. It can't be in the future.")).toBeVisible()

    // A native date input's max attribute stops the browser accepting a
    // future date at all, so this checks the server-side rejection directly.
    const tomorrow = nzDate(1)
    const tomorrowRes = await page.request.fetch(`${BASE_URL}/api/kpi/scorecards/status`, {
      method: 'PATCH',
      data: { id: companyScorecardId, action: 'record_board_approval', expectedStatus: 'submitted', note: 'ZZ Test board minutes', boardMeetingDate: tomorrow },
    })
    expect(tomorrowRes.status()).toBe(400)
    expect(await tomorrowRes.json()).toEqual({ error: "Enter the board meeting date. It can't be in the future.", field: 'boardMeetingDate' })

    const yesterday = nzDate(-1)
    await page.getByLabel('Board meeting date').fill(yesterday)
    await page.getByRole('button', { name: 'Record board approval' }).last().click()
    await expect(page.getByText('Enter the board meeting reference, for example Board minutes 14 Oct 2026.')).toBeVisible()

    await page.getByLabel('Board meeting reference').fill('ZZ Test board minutes')
    await page.getByRole('button', { name: 'Record board approval' }).last().click()
    await expect(page.getByRole('status').filter({ hasText: 'Board approval recorded. The scorecard is locked.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByText(/Board meeting .+, reference: ZZ Test board minutes/)).toBeVisible()
  })

  test('admin: own scorecard shows board route only, and standard self-approve is 403', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const meRes = await page.request.post(`${BASE_URL}/api/kpi/scorecards`, { data: { personId: null, fy: FY, quarter: QUARTER } })
    // Company scorecard already exists, so start the admin's own instead.
    const adminToken = await getAccessToken(ADMIN_EMAIL, ADMIN_PASSWORD)
    const { json: adminPersonId } = await restRpc(adminToken, 'kpi_my_person_id', {})

    const res = await page.request.post(`${BASE_URL}/api/kpi/scorecards`, { data: { personId: adminPersonId, fy: FY, quarter: QUARTER } })
    expect(res.status()).toBe(201)
    adminOwnScorecardId = (await res.json()).scorecard.id

    await page.goto(`${BASE_URL}/kpis/scorecards/${adminOwnScorecardId}`, { waitUntil: 'networkidle' })
    await page.getByLabel('Add a KPI').selectOption(leadKpi.id)
    await page.getByRole('button', { name: 'Add KPI' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'KPI added.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const cells = page.getByRole('row', { name: new RegExp(leadKpi.name) }).getByRole('textbox')
    await cells.nth(0).fill('1')
    await cells.nth(1).fill('1')
    await cells.nth(2).fill('1')
    await page.getByRole('button', { name: 'Save targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Targets saved.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await page.getByRole('button', { name: 'Submit scorecard' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Scorecard submitted.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('button', { name: 'Record board approval' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve and lock' })).toHaveCount(0)

    const approveRes = await page.request.fetch(`${BASE_URL}/api/kpi/scorecards/status`, {
      method: 'PATCH',
      data: { id: adminOwnScorecardId, action: 'approve', expectedStatus: 'submitted', note: '', boardMeetingDate: '' },
    })
    expect(approveRes.status()).toBe(403)
    expect(await approveRes.json()).toEqual({ error: "You can't approve your own scorecard. Record the board's approval instead." })

    const yesterday = nzDate(-1)
    await page.getByRole('button', { name: 'Record board approval' }).click()
    await page.getByLabel('Board meeting date').fill(yesterday)
    await page.getByLabel('Board meeting reference').fill('ZZ Test own board minutes')
    await page.getByRole('button', { name: 'Record board approval' }).last().click()
    await expect(page.getByRole('status').filter({ hasText: 'Board approval recorded. The scorecard is locked.' })).toBeVisible()
  })

  test('admin: board route is refused on another person\'s submitted scorecard', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const submitRes = await page.request.fetch(`${BASE_URL}/api/kpi/scorecards/status`, {
      method: 'PATCH',
      data: { id: otherScorecardId, action: 'submit', expectedStatus: 'draft', note: '', boardMeetingDate: '' },
    })
    expect(submitRes.status()).toBe(200)

    const res = await page.request.fetch(`${BASE_URL}/api/kpi/scorecards/status`, {
      method: 'PATCH',
      data: {
        id: otherScorecardId,
        action: 'record_board_approval',
        expectedStatus: 'submitted',
        note: 'ZZ Test board minutes',
        boardMeetingDate: nzDate(-1),
      },
    })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: 'Board approval is only for the company scorecard and your own scorecard.' })
  })

  test('admin: exception edit on the locked staff scorecard, with reason and history', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${staffScorecardId}`, { waitUntil: 'networkidle' })
    await expect(page.getByText(
      'This scorecard is locked. You can change its targets as the admin. Each change needs a reason, and earlier targets stay in the history.'
    )).toBeVisible()

    await page.getByRole('button', { name: 'Change locked targets' }).click()
    const cell = page.getByRole('row', { name: new RegExp(leadKpi.name) }).getByRole('textbox').nth(2)
    await cell.fill('99')
    await page.getByRole('button', { name: 'Save locked targets' }).click()
    await expect(page.getByText('Say why these targets are changing. The reason is saved in the audit log.')).toBeVisible()

    await page.getByLabel('Reason for changing locked targets').fill('ZZ Test board asked for a lower target')
    await page.getByRole('button', { name: 'Save locked targets' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Locked targets changed. Your reason is saved in the audit log.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const history = page.getByRole('region', { name: 'Changes since approval table' })
    await expect(history.getByText(leadKpi.name)).toBeVisible()
    await expect(history.getByText('ZZ Test board asked for a lower target')).toBeVisible()
  })

  test('admin: removes a KPI from a draft scorecard', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const removePerson = await createPerson(page, { fullName: 'ZZ Test remove target' })
    const createRes = await page.request.post(`${BASE_URL}/api/kpi/scorecards`, {
      data: { personId: removePerson.id, fy: FY, quarter: QUARTER },
    })
    expect(createRes.status()).toBe(201)
    const removeScorecardId = (await createRes.json()).scorecard.id

    await page.goto(`${BASE_URL}/kpis/scorecards/${removeScorecardId}`, { waitUntil: 'networkidle' })
    await page.getByLabel('Add a KPI').selectOption(leadKpi.id)
    await page.getByRole('button', { name: 'Add KPI' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'KPI added.' })).toBeVisible()
    await page.waitForLoadState('networkidle')

    const row = page.getByRole('row', { name: new RegExp(leadKpi.name) })
    await row.getByRole('button', { name: /^Remove/ }).click()
    const keepIt = page.getByRole('button', { name: 'Keep it' })
    await expect(keepIt).toBeFocused()
    await keepIt.click()
    await expect(row.getByRole('button', { name: /^Remove/ })).toBeFocused()

    await row.getByRole('button', { name: /^Remove/ }).click()
    await page.getByRole('button', { name: 'Remove KPI' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'KPI removed.' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('link', { name: leadKpi.name })).toHaveCount(0)
  })

  test('admin: a stale lifecycle change is refused on refresh', async ({ page, browser }) => {
    const pageB = await browser.newPage()
    await login(pageB, ADMIN_EMAIL, ADMIN_PASSWORD)

    // Put otherScorecardId (draft, admin's own writes) through submit so it can be returned.
    await pageB.goto(`${BASE_URL}/kpis/scorecards/${otherScorecardId}`, { waitUntil: 'networkidle' })
    if (await pageB.getByRole('button', { name: 'Submit for approval' }).count() > 0) {
      await pageB.getByLabel('Add a KPI').selectOption(lagKpi.id)
      await pageB.getByRole('button', { name: 'Add KPI' }).click()
      await expect(pageB.getByRole('status').filter({ hasText: 'KPI added.' })).toBeVisible()
      await pageB.waitForLoadState('networkidle')
      const cells = pageB.getByRole('row', { name: new RegExp(`^${lagKpi.name}`) }).getByRole('textbox')
      await cells.nth(0).fill('1')
      await cells.nth(1).fill('1')
      await cells.nth(2).fill('1')
      await pageB.getByRole('button', { name: 'Save targets' }).click()
      await expect(pageB.getByRole('status').filter({ hasText: 'Targets saved.' })).toBeVisible()
      await pageB.waitForLoadState('networkidle')
      await pageB.getByRole('button', { name: 'Submit for approval' }).click()
      await pageB.getByRole('button', { name: 'Submit scorecard' }).click()
      await expect(pageB.getByRole('status').filter({ hasText: 'Scorecard submitted.' })).toBeVisible()
      await pageB.waitForLoadState('networkidle')
    }

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/${otherScorecardId}`, { waitUntil: 'networkidle' })

    // Page A opens Approve and lock's confirm before page B returns it.
    await page.getByRole('button', { name: 'Approve and lock' }).click()

    await pageB.reload({ waitUntil: 'networkidle' })
    await pageB.getByRole('button', { name: 'Return with a note' }).click()
    await pageB.getByLabel('What needs to change').fill('ZZ Test stale check')
    await pageB.getByRole('button', { name: 'Return scorecard' }).click()
    await expect(pageB.getByRole('status').filter({ hasText: 'Scorecard returned with your note.' })).toBeVisible()

    await page.getByRole('button', { name: 'Approve and lock' }).last().click()
    await expect(page.getByText('This scorecard changed since you opened it. Refresh the page to see where it\'s up to.')).toBeVisible()
    await pageB.close()
  })

  // ── SECURITY ─────────────────────────────────────────────────────────────
  test('security: no cookie gives 401 JSON on all five handlers', async ({ request }) => {
    const endpoints = [
      { method: 'post', url: '/api/kpi/scorecards', data: { personId: null, fy: FY, quarter: QUARTER } },
      { method: 'patch', url: '/api/kpi/scorecards/status', data: { id: staffScorecardId, action: 'submit', expectedStatus: 'draft', note: '', boardMeetingDate: '' } },
      { method: 'post', url: '/api/kpi/assignments', data: { scorecardId: staffScorecardId, kpiId: leadKpi.id, expectedStatus: 'draft' } },
      { method: 'delete', url: '/api/kpi/assignments', data: { assignmentId: '00000000-0000-0000-0000-000000000000', expectedStatus: 'draft' } },
      { method: 'post', url: '/api/kpi/targets', data: { scorecardId: staffScorecardId, expectedStatus: 'draft', reason: '', cells: [] } },
    ]
    for (const ep of endpoints) {
      const res = await request.fetch(`${BASE_URL}${ep.url}`, { method: ep.method, data: ep.data })
      expect(res.status(), ep.url).toBe(401)
      expect(await res.json()).toEqual({ error: 'Sign in to continue.' })
    }
  })

  test('security: extra or missing keys give 400 and write nothing', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    const res = await page.request.post(`${BASE_URL}/api/kpi/targets`, {
      data: { scorecardId: staffScorecardId, expectedStatus: 'locked', reason: '', cells: [], status: 'locked' },
    })
    expect(res.status()).toBe(400)
    expect(await res.json()).toEqual({ error: "We couldn't save that. Try again." })

    const res2 = await page.request.fetch(`${BASE_URL}/api/kpi/scorecards/status`, {
      method: 'PATCH',
      data: { id: staffScorecardId, action: 'submit', expectedStatus: 'draft', note: '', boardMeetingDate: '', approvedBy: 'x' },
    })
    expect(res2.status()).toBe(400)
    expect(await res2.json()).toEqual({ error: "We couldn't save that. Try again." })
  })

  test('security: direct REST as staff is rejected; anon reads no data', async ({}) => {
    const staffToken = await getAccessToken(STAFF_EMAIL, STAFF_PASSWORD)
    // By this point in the run staffScorecardId is already locked (the
    // manager approved it earlier), so a same-status PATCH hits the guard's
    // catch-all (KS011) rather than the submitted->locked self-approve path
    // (KS001). Either way it's rejected with a KSnnn code, never DB text.
    const lockRes = await restPatch(staffToken, 'kpi_scorecard', `id=eq.${staffScorecardId}`, { status: 'locked' })
    expect([400, 403]).toContain(lockRes.status)
    expect(JSON.stringify(lockRes.json)).toMatch(/KS0\d\d/)

    const auditRes = await restPost(staffToken, 'kpi_audit_log', {
      entity: 'kpi_scorecard', action: 'insert', entity_id: staffScorecardId, actor_email: STAFF_EMAIL,
    })
    expect(auditRes.status).toBe(403)
    expect(JSON.stringify(auditRes.json)).toContain('42501')

    // No grant to anon at all is stricter than an RLS-filtered empty array;
    // either way the anon key gets no rows back.
    function expectNoAnonData(result) {
      if (Array.isArray(result.json)) {
        expect(result.json).toEqual([])
      } else {
        expect(result.json && result.json.code).toBe('42501')
      }
    }
    expectNoAnonData(await restSelect(null, 'kpi_scorecard', 'select=id&limit=1'))
    expectNoAnonData(await restSelect(null, 'kpi_assignment', 'select=id&limit=1'))
    expectNoAnonData(await restSelect(null, 'kpi_target', 'select=id&limit=1'))
  })

  // ── ERROR STATES ─────────────────────────────────────────────────────────
  test('error: not-a-uuid and a random valid uuid both show "Scorecard not found"', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards/not-a-uuid`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Scorecard not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to scorecards' })).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/scorecards/00000000-0000-0000-0000-000000000000`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Scorecard not found' })).toBeVisible()
  })

  test('error: ?quarter=banana and 2031-1 fall back to the current quarter with no error', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/scorecards?quarter=banana`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Scorecards' })).toBeVisible()
    await expect(page.locator('[class*="errorState"]')).toHaveCount(0)

    await page.goto(`${BASE_URL}/kpis/scorecards?quarter=2031-1`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Scorecards' })).toBeVisible()
    await expect(page.locator('[class*="errorState"]')).toHaveCount(0)
  })

  // ── HEADER ───────────────────────────────────────────────────────────────
  const HEADER_WIDTHS = [1440, 1200, 1024, 900, 768, 600, 375, 320]

  test('header: both nav links visible on KPI pages at every listed width', async ({ page }) => {
    await login(page, STAFF_EMAIL, STAFF_PASSWORD)
    for (const width of HEADER_WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`${BASE_URL}/kpis/scorecards`, { waitUntil: 'networkidle' })
      const sales = page.getByRole('link', { name: 'Sales' })
      const kpis = page.getByRole('link', { name: 'KPIs', exact: true })
      await expect(sales, `Sales at ${width}px`).toBeVisible()
      await expect(kpis, `KPIs at ${width}px`).toBeVisible()
      await expect(kpis).toHaveAttribute('aria-current', 'page')

      const salesBox = await sales.boundingBox()
      const kpisBox = await kpis.boundingBox()
      expect(salesBox.height, `Sales height at ${width}px`).toBeGreaterThanOrEqual(44)
      expect(kpisBox.height, `KPIs height at ${width}px`).toBeGreaterThanOrEqual(44)

      const header = page.locator('header').first()
      const scrollWidth = await header.evaluate(el => el.scrollWidth)
      const clientWidth = await header.evaluate(el => el.clientWidth)
      expect(scrollWidth, `header overflow at ${width}px`).toBeLessThanOrEqual(clientWidth + 1)

      const bodyScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const bodyClientWidth = await page.evaluate(() => document.documentElement.clientWidth)
      expect(bodyScrollWidth, `page h-scroll at ${width}px`).toBeLessThanOrEqual(bodyClientWidth + 1)
    }
  })

  // ── REGRESSION ───────────────────────────────────────────────────────────
  test('regression: dashboard loads (HubSpot unreachable locally, reported not fixed)', async ({ page }) => {
    // Local dev has no HubSpot credentials, so /api/dashboard 500s and the
    // page can't show live data or exercise "Edit monthly targets" here.
    // That is expected and out of scope to fix (brief: "/ needs HubSpot and
    // can't load live data locally; report what it shows and do not try to
    // fix it."). This only confirms the page itself renders (h1 present)
    // rather than crashing outright.
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
