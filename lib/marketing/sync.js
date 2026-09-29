// Runs one Mailchimp sync: logs the attempt, pulls reports, upserts the
// Mailchimp columns by mailchimp_id, and records the outcome. Called by
// /api/marketing/mailchimp-sync for both the Monday cron and the button.

import { fetchReports, reportToRow, MailchimpError } from './mailchimp.js'

const GENERIC_ERROR = "The sync didn't finish. Try again in a few minutes."

export async function runMailchimpSync({ admin, apiKey, trigger, fetchImpl }) {
  const { data: log, error: logError } = await admin
    .from('mkt_sync_log')
    .insert({ source: 'mailchimp', trigger })
    .select('id')
    .single()
  if (logError) {
    console.error('mkt_sync_log insert failed', logError)
    return { ok: false, error: GENERIC_ERROR }
  }

  async function finish(result) {
    const { error } = await admin
      .from('mkt_sync_log')
      .update({
        finished_at: new Date().toISOString(),
        ok: result.ok,
        campaigns: result.ok ? result.campaigns : null,
        error: result.ok ? null : result.error,
      })
      .eq('id', log.id)
    if (error) console.error('mkt_sync_log update failed', error)
    return result
  }

  if (!apiKey) {
    return finish({ ok: false, error: 'MAILCHIMP_API_KEY is not set in Vercel yet.' })
  }

  try {
    const syncedAt = new Date().toISOString()
    const reports = await fetchReports({ apiKey, fetchImpl })
    const rows = reports.map(r => reportToRow(r, syncedAt))
    if (rows.length > 0) {
      // Only the Mailchimp columns are in each row, so replies and enquiries
      // on existing rows are left exactly as they were.
      const { error } = await admin
        .from('mkt_email_campaign')
        .upsert(rows, { onConflict: 'mailchimp_id' })
      if (error) {
        console.error('mkt_email_campaign upsert failed', error)
        return finish({ ok: false, error: GENERIC_ERROR })
      }
    }
    return finish({ ok: true, campaigns: rows.length })
  } catch (err) {
    if (err instanceof MailchimpError) return finish({ ok: false, error: err.message })
    console.error('Mailchimp sync failed', err)
    return finish({ ok: false, error: GENERIC_ERROR })
  }
}
