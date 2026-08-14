const { test, expect } = require('@playwright/test')

// Local perimeter verification. Runs against `next dev` with DUMMY Supabase env
// (no real project/anon key available in this run), so real logins and RLS/DB
// checks are NOT covered here — those are deferred to deploy-time live testing.
// What this DOES verify: fail-closed redirect, /login rendering, API 401 JSON,
// no Basic Auth popup, design tokens, and responsive layout.
const BASE_URL = 'http://localhost:3000'

test.describe('Perimeter + login + API deny (dummy env)', () => {

  test.describe('Desktop 1280', () => {
    test.use({ viewport: { width: 1280, height: 900 } })

    test('unauthenticated / redirects to /login, no Basic Auth popup', async ({ page }) => {
      // If a native Basic Auth dialog appeared, this navigation would hang.
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
      await page.waitForURL(/\/login$/, { timeout: 5000 })
      await expect(page).toHaveURL(/\/login$/)
    })

    test('/login renders the Spoke sign-in page, no redirect loop', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      await expect(page).toHaveURL(/\/login$/)
      await expect(page.getByRole('heading', { name: 'Sales dashboard' })).toBeVisible()
      await expect(page.getByLabel('Email')).toBeVisible()
      await expect(page.getByLabel('Password')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
    })

    test('/login has no console errors', async ({ page }) => {
      const errors = []
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      expect(errors).toEqual([])
    })

    test('login heading uses DM Serif Display italic', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      const h = page.getByRole('heading', { name: 'Sales dashboard' })
      const family = await h.evaluate(el => getComputedStyle(el).fontFamily)
      const style = await h.evaluate(el => getComputedStyle(el).fontStyle)
      expect(family).toContain('DM Serif')
      expect(style).toBe('italic')
    })

    test('login inputs are 40px tall with 8px radius and a focus ring', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      const email = page.getByLabel('Email')
      const box = await email.boundingBox()
      expect(Math.round(box.height)).toBe(40)
      const radius = await email.evaluate(el => getComputedStyle(el).borderTopLeftRadius)
      expect(radius).toBe('8px')
      await email.focus()
      const shadow = await email.evaluate(el => getComputedStyle(el).boxShadow)
      // 3px zest ring -> rgb(190, 218, 129)
      expect(shadow).toContain('rgb(190, 218, 129)')
    })

    test('wrong-password login stays on /login and shows the error copy', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      await page.getByLabel('Email').fill('nobody@example.com')
      await page.getByLabel('Password').fill('definitely-wrong')
      await page.getByRole('button', { name: 'Log in' }).click()
      // Dummy Supabase endpoint is unreachable -> signInWithPassword errors ->
      // the page shows the standard error copy and does NOT navigate.
      await expect(page.getByText('Email or password is wrong. Try again.')).toBeVisible({ timeout: 8000 })
      await expect(page).toHaveURL(/\/login$/)
    })

    test('GET /api/dashboard with no session -> 401 JSON, not HTML redirect', async ({ request }) => {
      const res = await request.get(`${BASE_URL}/api/dashboard?month=2026-08&rep=full-team`)
      expect(res.status()).toBe(401)
      expect(res.headers()['content-type']).toContain('application/json')
      const body = await res.json()
      expect(body.error).toBeTruthy()
    })

    test('POST /api/targets with no session -> 401 JSON, writes nothing', async ({ request }) => {
      const res = await request.post(`${BASE_URL}/api/targets`, {
        data: { month: '2026-08', targets: { Ed: { calls: 1, visits: 1, pipeline: 1 }, Mark: { calls: 1, visits: 1, pipeline: 1 } }, salesBudget: 1 },
      })
      expect(res.status()).toBe(401)
      expect(res.headers()['content-type']).toContain('application/json')
    })

    test('no emoji or lock glyph on the login page', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      const text = await page.evaluate(() => document.body.innerText)
      expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F512}\u{1F513}]/u)
    })
  })

  test.describe('900px', () => {
    test.use({ viewport: { width: 900, height: 800 } })
    test('login card renders without horizontal overflow', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      expect(overflow).toBe(true)
    })
  })

  test.describe('600px', () => {
    test.use({ viewport: { width: 600, height: 800 } })
    test('login card renders at mobile width without overflow', async ({ page }) => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' })
      await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
      expect(overflow).toBe(true)
    })
  })
})
