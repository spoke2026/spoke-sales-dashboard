// Vercel Web Analytics API: weekly website numbers for the public Spoke site,
// mapped to mkt_web_week rows. Server only (the token must never reach the
// browser). Weeks run Monday to Sunday in Auckland time.
//
// Docs: https://vercel.com/docs/analytics/web-analytics-api
// Hobby keeps one month of analytics, so the sync copies each week into
// Supabase to keep the history.

import { todayInAuckland } from '../kpi/calendar.js'
import { mondayOf } from './months.js'

// The public website's Vercel project (spoke-website). Not secrets; override
// with env vars if the project ever moves.
export const WEBSITE_PROJECT_ID = 'prj_yAzMAxQsW5XeIL6RF1y9LVxj7ifb'
export const WEBSITE_TEAM_ID = 'team_HOpMeBQHuQ90H4rv1xgqRc8f'

// Analytics went live on the website on Tue 29 Sep 2026.
export const FIRST_WEEK = '2026-09-28'
export const DIRECT_LABEL = '(direct)'
const TOP_LIMIT = 10
const API = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate'

export class VercelAnalyticsError extends Error {
  constructor(message) {
    super(message)
    this.name = 'VercelAnalyticsError'
  }
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Minutes Auckland is ahead of UTC at an instant (720 NZST, 780 NZDT).
function aucklandOffsetMinutes(instant) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = type => Number(parts.find(p => p.type === type).value)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((wall - instant.getTime()) / 60000)
}

// The UTC instant of midnight at the start of an Auckland date.
export function aucklandMidnight(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d) - 12 * 3600000)
  let instant = new Date(Date.UTC(y, m - 1, d) - aucklandOffsetMinutes(guess) * 60000)
  // Second pass settles a guess that landed on the other side of a DST change.
  instant = new Date(Date.UTC(y, m - 1, d) - aucklandOffsetMinutes(instant) * 60000)
  return instant
}

export function weekRange(weekStart) {
  const since = aucklandMidnight(weekStart)
  const until = new Date(aucklandMidnight(addDays(weekStart, 7)).getTime() - 1)
  return { since: since.toISOString(), until: until.toISOString() }
}

// Last week (to finalise it) and this week (a running total), never before
// analytics started.
export function weeksToSync(instant = new Date()) {
  const thisWeek = mondayOf(todayInAuckland(instant))
  return [addDays(thisWeek, -7), thisWeek].filter(w => w >= FIRST_WEEK)
}

async function query({ token, projectId, teamId, since, until, by, limit, fetchImpl }) {
  const params = new URLSearchParams({ projectId, teamId, since, until, by })
  if (limit) params.set('limit', String(limit))
  let res
  try {
    res = await fetchImpl(`${API}?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  } catch {
    throw new VercelAnalyticsError("Couldn't reach Vercel. Try again in a few minutes.")
  }
  if (res.status === 401 || res.status === 403) {
    throw new VercelAnalyticsError('Vercel rejected the analytics token. Check VERCEL_ANALYTICS_TOKEN in Vercel.')
  }
  if (!res.ok) {
    // Vercel explains most failures in { error: { message } }; show it so a
    // wrong project or team can be told apart from an outage.
    let detail = ''
    try {
      const body = await res.json()
      detail = typeof body?.error?.message === 'string' ? ` ${body.error.message.slice(0, 200)}` : ''
    } catch {
      detail = ''
    }
    const hint = res.status === 404 ? ' Check the website project is in the same Vercel account as the token.' : ''
    throw new VercelAnalyticsError(`Vercel Analytics returned an error (${res.status}).${detail}${hint}`)
  }
  const body = await res.json()
  return Array.isArray(body.data) ? body.data : []
}

function count(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

// Top-N rows without Vercel's "Others" bucket.
function topRows(rows, key) {
  return rows.filter(r => r[key] !== 'Others')
}

export async function fetchWeek({ token, projectId = WEBSITE_PROJECT_ID, teamId = WEBSITE_TEAM_ID, weekStart, fetchImpl = fetch }) {
  const { since, until } = weekRange(weekStart)
  const base = { token, projectId, teamId, since, until, fetchImpl }
  // Grouping by environment (production only, by default) gives one row with
  // the week's true unique visitors, which adding up days or pages cannot.
  const [totals, pages, referrers] = await Promise.all([
    query({ ...base, by: 'environment' }),
    query({ ...base, by: 'requestPath', limit: TOP_LIMIT }),
    query({ ...base, by: 'referrerHostname', limit: TOP_LIMIT }),
  ])
  const production = totals.find(r => r.environment === 'production') || totals[0] || {}
  return {
    week_start: weekStart,
    visitors: count(production.visitors),
    page_views: count(production.pageviews),
    top_pages: topRows(pages, 'requestPath')
      .map(r => ({ path: String(r.requestPath || '/'), views: count(r.pageviews) })),
    top_referrers: topRows(referrers, 'referrerHostname')
      .map(r => ({ site: r.referrerHostname ? String(r.referrerHostname) : DIRECT_LABEL, visitors: count(r.visitors) })),
    source: 'vercel_api',
  }
}
