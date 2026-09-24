const { test, expect } = require('@playwright/test')

// KPI library (Phase 2a) — Library, Admin, Security, Error-handling and
// Regression criteria. Runs against a local production build (npm run build
// && npm run start) or a Vercel preview pointed at the shared Supabase
// project. No credentials are stored here: every login and, for the direct
// REST checks, the Supabase URL/anon key come from env vars at run time.
//
//   E2E_BASE_URL            required — e.g. http://localhost:3000
//   E2E_ADMIN_EMAIL         required — edward@spoke.nz
//   E2E_ADMIN_PASSWORD      required
//   E2E_USER_EMAIL          required — a non-admin test login
//   E2E_USER_PASSWORD       required
//   E2E_USER_NAME           optional — the non-admin's kpi_person full name, if one exists
//   E2E_SUPABASE_URL        optional — enables the direct REST checks
//   E2E_SUPABASE_ANON_KEY   optional — enables the direct REST checks
//
// Every KPI this spec creates is named "ZZ Test ..." with a run-unique
// suffix, per the DB CAVEAT: Preview, local production builds and
// Production share ONE Supabase project. supabase/verify/0004_remove_test_rows.sql
// removes every version of any KPI that ever had a ZZ Test name.

const BASE_URL = process.env.E2E_BASE_URL
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD
const USER_EMAIL = process.env.E2E_USER_EMAIL
const USER_PASSWORD = process.env.E2E_USER_PASSWORD
const SUPABASE_URL = process.env.E2E_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY

const HAVE_LOGINS = Boolean(BASE_URL && ADMIN_EMAIL && ADMIN_PASSWORD && USER_EMAIL && USER_PASSWORD)
const HAVE_REST = Boolean(HAVE_LOGINS && SUPABASE_URL && SUPABASE_ANON_KEY)

const LOGIN_SKIP_REASON =
  'E2E_BASE_URL, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD, E2E_USER_EMAIL and E2E_USER_PASSWORD must all be set'
const REST_SKIP_REASON = 'E2E_SUPABASE_URL and E2E_SUPABASE_ANON_KEY must be set for the direct REST checks'

// Unique per test run so reruns against the shared DB never collide with the
// case-insensitive duplicate-name rule.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

const NAMES = {
  main: `ZZ Test visits ${RUN}`,
  mainEdited: `ZZ Test visits logged ${RUN}`,
  dup: `ZZ Test visits ${RUN} dup`,
  retire: `ZZ Test retire me ${RUN}`,
  automated: `ZZ Test automated mapping ${RUN}`,
  percent: `ZZ Test conversion rate ${RUN}`,
  zeroTarget: `ZZ Test zero target ${RUN}`,
  longMapping: `ZZ Test long mapping ${RUN}`,
  rest: `ZZ Test rest proposal ${RUN}`,
}

async function login(page, email, password) {
  // /login sends a signed-in user straight on, so start every login signed out.
  await page.context().clearCookies()
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 })
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trackConsoleErrors(page) {
  const errors = []
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

async function fillDefinitionForm(page, values) {
  await page.getByLabel('Name', { exact: true }).fill(values.name)
  await page.getByLabel('What it measures and why it matters', { exact: true }).fill(values.description)
  if (values.kpiType) await page.getByLabel('Type', { exact: true }).selectOption({ label: values.kpiType })
  if (values.unit) await page.getByLabel('Unit', { exact: true }).selectOption({ label: values.unit })
  if (values.direction) await page.getByLabel('Direction', { exact: true }).selectOption({ label: values.direction })
  if (values.aggregation) await page.getByLabel('How values combine', { exact: true }).selectOption({ label: values.aggregation })
  if (values.attributionMethod) {
    await page.getByLabel('Who it counts towards', { exact: true }).selectOption({ label: values.attributionMethod })
  }
  if (values.phasing) await page.getByLabel('Target spread', { exact: true }).selectOption({ label: values.phasing })
  if (values.source) await page.getByLabel('Data source', { exact: true }).selectOption({ label: values.source })
  if (values.sourceMapping !== undefined) {
    await page.getByLabel('Source mapping (optional)', { exact: true }).fill(values.sourceMapping)
  }
  if (values.attributionNote !== undefined) {
    await page.getByLabel('Note on who it counts towards (optional)', { exact: true }).fill(values.attributionNote)
  }
  if (values.exampleTarget !== undefined) {
    await page.getByLabel('Example monthly target (optional)', { exact: true }).fill(values.exampleTarget)
  }
}

async function propose(page, values) {
  await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
  await fillDefinitionForm(page, values)
  await page.getByRole('button', { name: 'Propose KPI' }).click()
  await page.waitForURL(/\/kpis\/library\/[0-9a-f-]+\?notice=proposed/, { timeout: 10000 })
  const url = page.url()
  return url.match(/\/kpis\/library\/([0-9a-f-]+)\?/)[1]
}

const BASE_VALUES = {
  description: 'A ZZ Test KPI created by the kpi-library Playwright spec.',
  kpiType: 'Lead (drives future results)',
  unit: 'Count',
  direction: 'Higher is better',
  aggregation: 'Sum: adds up over the period',
  attributionMethod: 'The person the entry is for',
  phasing: 'Across working days',
  source: 'Manual entry',
  sourceMapping: '',
  attributionNote: '',
  exampleTarget: '20',
}

// ── LIBRARY, ANY SIGNED-IN USER + ADMIN LIFECYCLE ──────────────────────────
test.describe.serial('KPI library — non-admin propose, admin publish/edit/retire', () => {
  test.skip(!HAVE_LOGINS, LOGIN_SKIP_REASON)

  let kpiId

  test('non-admin: /kpis shows "KPI library" and it leads to /kpis/library', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })

    const start = Date.now()
    await page.getByRole('link', { name: 'KPI library' }).click()
    await page.waitForURL(/\/kpis\/library$/)
    expect(Date.now() - start).toBeLessThan(3000)

    await expect(page).toHaveTitle('KPI library | Spoke Sales Dashboard')
    await expect(page.getByRole('heading', { level: 1, name: 'KPI library' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'KPIs' })).toHaveAttribute('aria-current', 'page')

    const headings = page.getByRole('heading', { level: 2 })
    await expect(headings.nth(0)).toHaveText('Published')
    await expect(headings.nth(1)).toHaveText('Proposed')
    await expect(headings.nth(2)).toHaveText('Retired')

    expect(errors).toEqual([])
  })

  test('non-admin: proposes "ZZ Test visits" and lands on the detail page', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    kpiId = await propose(page, { ...BASE_VALUES, name: NAMES.main })

    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'KPI proposed.' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: NAMES.main })).toBeVisible()
    await expect(page.locator('[class*="statusTag"]')).toHaveText('Proposed')
    await expect(page.getByText('Version 1', { exact: true })).toBeVisible()

    // "Proposed by" sits in the definition <dl>: the proposer's kpi_person name
    // (E2E_USER_NAME, when that person exists) or else their email, never
    // "Not recorded".
    const proposedBy = page.locator('dt', { hasText: 'Proposed by' }).locator('xpath=following-sibling::dd[1]')
    await expect(proposedBy).toHaveText(new RegExp(`^(${escapeRegExp(process.env.E2E_USER_NAME || USER_EMAIL)}|${escapeRegExp(USER_EMAIL)}) on \\w{3} \\d{1,2} \\w{3} \\d{4}$`))
  })

  test('non-admin: the KPI is listed under Proposed on /kpis/library', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library`, { waitUntil: 'networkidle' })
    const proposedTable = page.getByRole('region', { name: 'Proposed KPIs table' })
    await expect(proposedTable.getByRole('link', { name: NAMES.main })).toBeVisible()
  })

  test('non-admin: detail page has no Edit/Publish/Retire, and a disabled Preview button', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/${kpiId}`, { waitUntil: 'networkidle' })

    await expect(page.getByRole('link', { name: 'Edit KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retire KPI' })).toHaveCount(0)

    const preview = page.getByRole('button', { name: 'Preview last 90 days' })
    await expect(preview).toBeDisabled()
    const describedBy = await preview.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    await expect(page.locator(`#${describedBy}`)).toHaveText('Not available until a data source is connected.')
  })

  test('non-admin: /edit shows the admin-only message and no form', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/${kpiId}/edit`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'Edit KPI' })).toBeVisible()
    await expect(page.getByText('Only the admin can edit KPIs.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to the KPI' })).toBeVisible()
    await expect(page.locator('form')).toHaveCount(0)
  })

  test('admin: publishes the KPI via the confirm', async ({ page }) => {
    const errors = trackConsoleErrors(page)
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/${kpiId}`, { waitUntil: 'networkidle' })

    await page.getByRole('button', { name: 'Publish KPI' }).click()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()

    let requestCount = 0
    await page.route('**/api/kpi/definitions/status', async route => {
      requestCount++
      await route.continue()
    })
    const confirmPublish = page.getByRole('button', { name: 'Publish KPI' })
    await Promise.all([confirmPublish.dispatchEvent('click'), confirmPublish.dispatchEvent('click')])

    const publishedStatus = page.getByRole('main').getByRole('status').filter({ hasText: 'KPI published.' })
    await expect(publishedStatus).toBeVisible()
    await expect(publishedStatus).toBeFocused()
    expect(requestCount).toBe(1)
    await page.unroute('**/api/kpi/definitions/status')

    await expect(page.locator('[class*="statusTag"]')).toHaveText('Published')

    await page.goto(`${BASE_URL}/kpis/library`, { waitUntil: 'networkidle' })
    const publishedTable = page.getByRole('region', { name: 'Published KPIs table' })
    await expect(publishedTable.getByRole('link', { name: NAMES.main })).toBeVisible()

    expect(errors).toEqual([])
  })

  test('admin: edits the name, saving a new version', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/${kpiId}/edit`, { waitUntil: 'networkidle' })
    await page.getByLabel('Name', { exact: true }).fill(NAMES.mainEdited)
    await page.getByRole('button', { name: 'Save new version' }).click()

    await page.waitForURL(/\?notice=saved/)
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'New version saved.' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: NAMES.mainEdited })).toBeVisible()
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible()
    await expect(page.locator('[class*="statusTag"]')).toHaveText('Published')

    const historyTable = page.getByRole('region', { name: 'Version history table' })
    await expect(historyTable.getByText('v1')).toBeVisible()
    await expect(historyTable.getByText('v2')).toBeVisible()
  })

  test('admin: ?version=1 shows the original name, read-only, no controls', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/${kpiId}?version=1`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: NAMES.main })).toBeVisible()
    await expect(page.getByText("You're viewing version 1. The current version is 2.")).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retire KPI' })).toHaveCount(0)
  })

  test('admin: no-op save reports nothing changed and mints no version 3', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/${kpiId}/edit`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.getByText('Nothing has changed. Edit a field or cancel.')).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/library/${kpiId}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible()
    await expect(page.getByText('Version 3', { exact: true })).toHaveCount(0)
  })

  test('admin: a stale PATCH (version 1) returns 409 and writes nothing', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const res = await page.request.patch(`${BASE_URL}/api/kpi/definitions`, {
      // A genuine change, so without the version check this would save
      // version 3 (200) rather than stop at "Nothing has changed" (rule 15).
      data: {
        ...BASE_VALUES,
        name: NAMES.mainEdited,
        description: 'A stale edit that must never be saved.',
        kpiType: 'lead',
        unit: 'count',
        direction: 'higher',
        aggregation: 'sum',
        attributionMethod: 'entered_for_person',
        phasing: 'working_days',
        source: 'manual',
        id: kpiId,
        version: 1,
      },
    })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body).toEqual({
      error: 'This KPI changed since you opened it. Refresh the page to see the latest version.',
    })

    await page.goto(`${BASE_URL}/kpis/library/${kpiId}`, { waitUntil: 'networkidle' })
    await expect(page.getByText('Version 2', { exact: true })).toBeVisible()
    await expect(page.getByText('Version 3', { exact: true })).toHaveCount(0)
  })

  test('admin: retire flow — Keep it does nothing, confirm retires with focus management', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const id = await propose(page, { ...BASE_VALUES, name: NAMES.retire })
    // Reload without the ?notice=proposed query so the page-level status
    // paragraph doesn't collide with StatusActions' own role="status" region.
    await page.goto(`${BASE_URL}/kpis/library/${id}`, { waitUntil: 'networkidle' })
    // Publish it first (retire is only offered from proposed or published).
    await page.getByRole('button', { name: 'Publish KPI' }).click()
    await page.getByRole('button', { name: 'Publish KPI' }).click()
    await expect(page.getByRole('main').getByRole('status').filter({ hasText: 'KPI published.' })).toBeVisible()

    const retireOpener = page.getByRole('button', { name: 'Retire KPI' })
    await retireOpener.click()
    const keepIt = page.getByRole('button', { name: 'Keep it' })
    await expect(keepIt).toBeFocused()
    await keepIt.click()
    await expect(page.getByRole('button', { name: 'Retire KPI' })).toBeFocused()

    await page.getByRole('button', { name: 'Retire KPI' }).click()
    await expect(page.getByRole('button', { name: 'Keep it' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Retire KPI' })).toBeFocused()

    await page.getByRole('button', { name: 'Retire KPI' }).click()
    await page.getByRole('button', { name: 'Retire KPI' }).click()
    const retiredStatus = page.getByRole('main').getByRole('status').filter({ hasText: 'KPI retired.' })
    await expect(retiredStatus).toBeVisible()
    await expect(retiredStatus).toBeFocused()

    await expect(page.getByRole('link', { name: 'Edit KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish KPI' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Retire KPI' })).toHaveCount(0)

    await page.goto(`${BASE_URL}/kpis/library`, { waitUntil: 'networkidle' })
    const retiredTable = page.getByRole('region', { name: 'Retired KPIs table' })
    const row = retiredTable.locator('tr', { hasText: NAMES.retire })
    await expect(row).toContainText('Not available for new scorecards')

    await page.goto(`${BASE_URL}/kpis/library/${id}/edit`, { waitUntil: 'networkidle' })
    await expect(page.getByText("Retired KPIs can't be edited.")).toBeVisible()
  })

  test('admin: jsonb key reordering does not trigger a spurious version', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await propose(page, {
      ...BASE_VALUES,
      name: NAMES.automated,
      source: 'HubSpot',
      sourceMapping: '{"b": 1, "a": 2}',
    })
    const detailUrl = page.url().split('?')[0]
    await page.goto(`${detailUrl}/edit`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Save new version' }).click()
    await expect(page.getByText('Nothing has changed. Edit a field or cancel.')).toBeVisible()
  })
})

// ── VALIDATION (non-admin) ─────────────────────────────────────────────────
test.describe('Propose form validation', () => {
  test.skip(!HAVE_LOGINS, LOGIN_SKIP_REASON)

  test('empty submit shows the name error, keeps values, and focuses Name', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
    await page.getByLabel('What it measures and why it matters', { exact: true }).fill('Kept on error.')
    await page.getByRole('button', { name: 'Propose KPI' }).click()

    await expect(page.getByText('Enter a KPI name.')).toBeVisible()
    await expect(page.getByLabel('Name', { exact: true })).toBeFocused()
    await expect(page.getByLabel('What it measures and why it matters', { exact: true })).toHaveValue('Kept on error.')
  })

  test('a duplicate name (case-insensitive) is rejected and creates nothing', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await propose(page, { ...BASE_VALUES, name: NAMES.dup })

    await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
    await fillDefinitionForm(page, { ...BASE_VALUES, name: NAMES.dup.toUpperCase() })
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await expect(page.getByText('A KPI with that name already exists.')).toBeVisible()

    await page.goto(`${BASE_URL}/kpis/library`, { waitUntil: 'networkidle' })
    const proposedTable = page.getByRole('region', { name: 'Proposed KPIs table' })
    await expect(proposedTable.getByRole('link', { name: NAMES.dup })).toHaveCount(1)
  })

  test('source mapping validation and the manual-KPI-with-mapping rule', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
    await fillDefinitionForm(page, { ...BASE_VALUES, name: `ZZ Test mapping ${RUN}` })

    await page.getByLabel('Source mapping (optional)', { exact: true }).fill('{oops')
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await expect(
      page.getByText('Enter the source mapping as a JSON object, or leave it blank.')
    ).toBeVisible()

    await page.getByLabel('Source mapping (optional)', { exact: true }).fill('[1]')
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await expect(
      page.getByText('Enter the source mapping as a JSON object, or leave it blank.')
    ).toBeVisible()

    await page.getByLabel('Source mapping (optional)', { exact: true }).fill('{"a": 1}')
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await expect(
      page.getByText("Manual KPIs don't use a source mapping. Clear this field.")
    ).toBeVisible()
  })

  test('example target: negative is rejected, zero is accepted and shown as "0"', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
    await fillDefinitionForm(page, { ...BASE_VALUES, name: NAMES.zeroTarget, exampleTarget: '-5' })
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await expect(
      page.getByText('Enter a number of 0 or more, without commas or symbols, or leave it blank.')
    ).toBeVisible()

    await page.getByLabel('Example monthly target (optional)', { exact: true }).fill('0')
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await page.waitForURL(/\?notice=proposed/)
    await expect(page.locator('dt', { hasText: 'Example monthly target' }).locator('xpath=following-sibling::dd[1]')).toHaveText('0')
  })

  test('a percent KPI shows a clean "29%", never a float remainder', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
    await fillDefinitionForm(page, {
      ...BASE_VALUES,
      name: NAMES.percent,
      unit: 'Percent (%)',
      exampleTarget: '29',
    })
    await page.getByRole('button', { name: 'Propose KPI' }).click()
    await page.waitForURL(/\?notice=proposed/)
    await expect(page.locator('dt', { hasText: 'Example monthly target' }).locator('xpath=following-sibling::dd[1]')).toHaveText('29%')
  })
})

// ── SECURITY ────────────────────────────────────────────────────────────────
test.describe('Security', () => {
  test.skip(!HAVE_LOGINS, LOGIN_SKIP_REASON)

  test('no session: POST/PATCH the definitions routes return 401 JSON, not a redirect', async ({ request }) => {
    const body = { ...BASE_VALUES, name: 'ZZ Test unauth', kpiType: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum', attributionMethod: 'entered_for_person', phasing: 'working_days', source: 'manual' }
    for (const call of [
      () => request.post(`${BASE_URL}/api/kpi/definitions`, { data: body }),
      () => request.patch(`${BASE_URL}/api/kpi/definitions`, { data: { ...body, id: '00000000-0000-0000-0000-000000000000', version: 1 } }),
      () => request.patch(`${BASE_URL}/api/kpi/definitions/status`, { data: { id: '00000000-0000-0000-0000-000000000000', version: 1, status: 'published' } }),
    ]) {
      const res = await call()
      expect(res.status()).toBe(401)
      expect(res.headers()['content-type']).toContain('application/json')
      const json = await res.json()
      expect(json).toEqual({ error: 'Sign in to continue.' })
    }
  })

  test('non-admin session: PATCH both admin routes return 403 and write nothing', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    const body = { ...BASE_VALUES, name: 'ZZ Test forbidden', kpiType: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum', attributionMethod: 'entered_for_person', phasing: 'working_days', source: 'manual', id: '00000000-0000-0000-0000-000000000000', version: 1 }
    const res1 = await page.request.patch(`${BASE_URL}/api/kpi/definitions`, { data: body })
    expect(res1.status()).toBe(403)
    expect(await res1.json()).toEqual({ error: 'Only the admin can make changes here.' })

    const res2 = await page.request.patch(`${BASE_URL}/api/kpi/definitions/status`, {
      data: { id: '00000000-0000-0000-0000-000000000000', version: 1, status: 'published' },
    })
    expect(res2.status()).toBe(403)
    expect(await res2.json()).toEqual({ error: 'Only the admin can make changes here.' })
  })

  test('POST with an extra key returns 400 and writes nothing', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    const body = { ...BASE_VALUES, name: `ZZ Test extra key ${RUN}`, kpiType: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum', attributionMethod: 'entered_for_person', phasing: 'working_days', source: 'manual', evil: 1 }
    const res = await page.request.post(`${BASE_URL}/api/kpi/definitions`, { data: body })
    expect(res.status()).toBe(400)

    await page.goto(`${BASE_URL}/kpis/library`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: `ZZ Test extra key ${RUN}` })).toHaveCount(0)
  })

  test('direct REST: non-admin token is fenced by RLS, anon SELECT returns nothing', async ({ request }) => {
    test.skip(!HAVE_REST, REST_SKIP_REASON)

    const tokenRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      data: { email: USER_EMAIL, password: USER_PASSWORD },
    })
    const { access_token: accessToken } = await tokenRes.json()
    expect(accessToken).toBeTruthy()

    const authedHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }

    const publishAttempt = await request.post(`${SUPABASE_URL}/rest/v1/kpi_definition`, {
      headers: authedHeaders,
      data: { name: `ZZ Test rest published ${RUN}`, description: 'x', kpi_type: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum', phasing: 'working_days', source: 'manual', status: 'published' },
    })
    expect(publishAttempt.ok()).toBe(false)

    // A real proposal IS accepted (by design: RLS is the boundary, the API is
    // the friendly layer). Its row is then the target for the "PATCH affects
    // 0 rows" check below, so that check proves RLS against a row that
    // genuinely exists rather than a fabricated id that would trivially
    // return 0 rows either way (rule 14).
    const proposalAttempt = await request.post(`${SUPABASE_URL}/rest/v1/kpi_definition`, {
      headers: authedHeaders,
      data: { name: NAMES.rest, description: 'A REST-only ZZ Test proposal.', kpi_type: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum', phasing: 'working_days', source: 'manual', status: 'proposed', version: 1 },
    })
    expect(proposalAttempt.ok()).toBe(true)
    const [proposedRow] = await proposalAttempt.json()
    expect(proposedRow.id).toBeTruthy()

    const patchAttempt = await request.patch(`${SUPABASE_URL}/rest/v1/kpi_definition?id=eq.${proposedRow.id}`, {
      headers: authedHeaders,
      data: { status: 'published' },
    })
    expect(patchAttempt.ok()).toBe(true)
    const patched = await patchAttempt.json()
    expect(patched).toEqual([])

    const anonRead = await request.get(`${SUPABASE_URL}/rest/v1/kpi_definition?select=id`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    })
    // 0003 revokes every anon privilege, so PostgREST refuses (401, 42501)
    // rather than returning an empty list. Either way, no data comes back.
    const anonBody = await anonRead.json()
    if (anonRead.ok()) {
      expect(anonBody).toEqual([])
    } else {
      expect([401, 403]).toContain(anonRead.status())
      expect(Array.isArray(anonBody)).toBe(false)
    }
  })
})

// ── ERROR HANDLING ──────────────────────────────────────────────────────────
test.describe('Error handling', () => {
  test.skip(!HAVE_LOGINS, LOGIN_SKIP_REASON)

  test('a non-UUID id shows "KPI not found", not the load-error message', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/not-a-uuid`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'KPI not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to the KPI library' })).toBeVisible()
    await expect(page.getByText("We couldn't load the KPI library.")).toHaveCount(0)
  })

  test('a random valid UUID with no row shows "KPI not found"', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis/library/11111111-1111-1111-1111-111111111111`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('heading', { level: 1, name: 'KPI not found' })).toBeVisible()
    await expect(page.getByText("We couldn't load the KPI library.")).toHaveCount(0)
  })
})

// ── REGRESSION ───────────────────────────────────────────────────────────────
test.describe('Regression', () => {
  test.skip(!HAVE_LOGINS, LOGIN_SKIP_REASON)

  test('/kpis shows "KPI library" for both roles, "Manage people and teams" admin only', async ({ page }) => {
    await login(page, USER_EMAIL, USER_PASSWORD)
    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: 'KPI library' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage people and teams' })).toHaveCount(0)

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })
    await expect(page.getByRole('link', { name: 'KPI library' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Manage people and teams' })).toBeVisible()
  })

  test('no console errors on the KPI library pages', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    const errors = trackConsoleErrors(page)

    await page.goto(`${BASE_URL}/kpis`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE_URL}/kpis/library`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE_URL}/kpis/library/new`, { waitUntil: 'networkidle' })
    const id = await propose(page, { ...BASE_VALUES, name: `ZZ Test console check ${RUN}` })
    await page.goto(`${BASE_URL}/kpis/library/${id}`, { waitUntil: 'networkidle' })
    await page.goto(`${BASE_URL}/kpis/library/${id}/edit`, { waitUntil: 'networkidle' })

    expect(errors).toEqual([])
  })

  test.describe('Responsive — no page-level horizontal scroll, including a long JSON line', () => {
    for (const width of [1280, 900, 600, 320]) {
      test(`${width}px`, async ({ page }) => {
        test.setTimeout(60000)
        await page.setViewportSize({ width, height: 900 })
        await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
        const longValue = 'x'.repeat(500)
        const id = await propose(page, {
          ...BASE_VALUES,
          name: `${NAMES.longMapping} ${width}`,
          source: 'HubSpot',
          sourceMapping: `{"a": "${longValue}"}`,
        })
        await page.goto(`${BASE_URL}/kpis/library/${id}`, { waitUntil: 'networkidle' })
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
        expect(overflow).toBe(true)
      })
    }
  })
})
