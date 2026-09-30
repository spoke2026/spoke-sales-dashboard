// Runs the Marketing syncs. Each source (Mailchimp, Vercel Web Analytics) is
// logged separately in mkt_sync_log so the tab can show its own "Last updated".
// Called by /api/marketing/sync for the Monday cron, the Refresh
// button and the tab's automatic refresh.

import { fetchReports, reportToRow, MailchimpError } from './mailchimp.js'
import { fetchWeek, weeksToSync, VercelAnalyticsError } from './vercelAnalytics.js'

const GENERIC_ERROR = "The sync didn't finish. Try again in a few minutes."

// The tab refreshes itself when its numbers are older than this. The server
// enforces it too, so many open tabs can't hammer Mailchimp or Vercel.
export const AUTO_REFRESH_MS = 15 * 60 * 1000

// Logs one attempt, runs `work` (which returns how many rows it wrote), and
// records the outcome. Known errors keep their friendly message.
async function logged(admin, source, trigger, work) {
  const { data: log, error: logError } = await admin
    .from('mkt_sync_log')
    .insert({ source, trigger })
    .select('id')
    .single()
  if (logError) {
    console.error('mkt_sync_log insert failed', logError)
    return { ok: false, error: GENERIC_ERROR }
  }

  let result
  try {
    result = await work()
  } catch (err) {
    if (err instanceof MailchimpError || err instanceof VercelAnalyticsError) {
      result = { ok: false, error: err.message }
    } else {
      console.error(`${source} sync failed`, err)
      result = { ok: false, error: GENERIC_ERROR }
    }
  }

  const { error } = await admin
    .from('mkt_sync_log')
    .update({
      finished_at: new Date().toISOString(),
      ok: result.ok,
      campaigns: result.ok ? result.count : null,
      error: result.ok ? null : result.error,
    })
    .eq('id', log.id)
  if (error) console.error('mkt_sync_log update failed', error)
  return result
}

async function upsert(admin, table, rows, onConflict) {
  if (rows.length === 0) return { ok: true, count: 0 }
  const { error } = await admin.from(table).upsert(rows, { onConflict })
  if (error) {
    console.error(`${table} upsert failed`, error)
    return { ok: false, error: GENERIC_ERROR }
  }
  return { ok: true, count: rows.length }
}

export function runMailchimpSync({ admin, apiKey, trigger, fetchImpl }) {
  return logged(admin, 'mailchimp', trigger, async () => {
    if (!apiKey) return { ok: false, error: 'MAILCHIMP_API_KEY is not set in Vercel yet.' }
    const syncedAt = new Date().toISOString()
    const reports = await fetchReports({ apiKey, fetchImpl })
    // Only the Mailchimp columns are in each row, so replies and enquiries on
    // existing rows are left exactly as they were.
    return upsert(admin, 'mkt_email_campaign', reports.map(r => reportToRow(r, syncedAt)), 'mailchimp_id')
  })
}

// Last week and this week. Vercel is the source of truth for any week it has,
// so these rows replace numbers typed in by hand for the same week.
export function runVercelSync({ admin, token, projectId, teamId, trigger, fetchImpl, now = new Date() }) {
  return logged(admin, 'vercel', trigger, async () => {
    if (!token) return { ok: false, error: 'VERCEL_ANALYTICS_TOKEN is not set in Vercel yet.' }
    const weeks = []
    for (const weekStart of weeksToSync(now)) {
      weeks.push(await fetchWeek({ token, projectId, teamId, weekStart, fetchImpl }))
    }
    return upsert(admin, 'mkt_web_week', weeks, 'week_start')
  })
}

// True when this source was last tried less than AUTO_REFRESH_MS ago. Counts
// failed attempts too, so a broken key doesn't retry on every page view.
export async function recentlySynced(admin, source, now = Date.now()) {
  const { data, error } = await admin
    .from('mkt_sync_log')
    .select('started_at')
    .eq('source', source)
    .order('started_at', { ascending: false })
    .limit(1)
  if (error) {
    console.error('mkt_sync_log read failed', error)
    return true
  }
  return data.length > 0 && now - new Date(data[0].started_at).getTime() < AUTO_REFRESH_MS
}
