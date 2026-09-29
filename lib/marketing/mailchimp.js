// Mailchimp Marketing API: campaign reports since 1 September 2026, mapped to
// mkt_email_campaign rows. Server only (the API key must never reach the
// browser). The row mapper deliberately has no replies or enquiries keys, so
// an upsert can never overwrite what the admin typed in.

export const SYNC_SINCE = '2026-09-01T00:00:00+12:00'
const PAGE_SIZE = 100

const REPORT_FIELDS = [
  'total_items',
  'reports.id',
  'reports.campaign_title',
  'reports.subject_line',
  'reports.emails_sent',
  'reports.send_time',
  'reports.opens.unique_opens',
  'reports.opens.open_rate',
  'reports.clicks.unique_subscriber_clicks',
  'reports.clicks.click_rate',
].join(',')

export class MailchimpError extends Error {
  constructor(message) {
    super(message)
    this.name = 'MailchimpError'
  }
}

// Mailchimp keys end in the data centre, e.g. "...-us21".
export function dataCenterOf(apiKey) {
  const match = typeof apiKey === 'string' ? apiKey.trim().match(/-([a-z]+\d+)$/) : null
  if (!match) throw new MailchimpError('The Mailchimp API key looks wrong. It should end in something like -us21.')
  return match[1]
}

function count(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0
}

function rate(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function reportToRow(report, syncedAt) {
  const uniqueOpens = count(report.opens?.unique_opens)
  const uniqueClicks = count(report.clicks?.unique_subscriber_clicks)
  return {
    mailchimp_id: String(report.id),
    send_time: report.send_time,
    campaign_name: report.campaign_title || '',
    subject_line: report.subject_line || '',
    recipients: count(report.emails_sent),
    unique_opens: uniqueOpens,
    open_rate: rate(report.opens?.open_rate),
    unique_clicks: uniqueClicks,
    click_rate: rate(report.clicks?.click_rate),
    click_to_open: uniqueOpens > 0 ? uniqueClicks / uniqueOpens : 0,
    synced_at: syncedAt,
  }
}

export async function fetchReports({ apiKey, since = SYNC_SINCE, fetchImpl = fetch }) {
  const dc = dataCenterOf(apiKey)
  const auth = `Basic ${Buffer.from(`spoke:${apiKey.trim()}`).toString('base64')}`
  const reports = []
  let offset = 0
  for (;;) {
    const params = new URLSearchParams({
      count: String(PAGE_SIZE),
      offset: String(offset),
      since_send_time: since,
      fields: REPORT_FIELDS,
    })
    let res
    try {
      res = await fetchImpl(`https://${dc}.api.mailchimp.com/3.0/reports?${params}`, {
        headers: { Authorization: auth },
        cache: 'no-store',
      })
    } catch {
      throw new MailchimpError("Couldn't reach Mailchimp. Try again in a few minutes.")
    }
    if (res.status === 401 || res.status === 403) {
      throw new MailchimpError('Mailchimp rejected the API key. Check MAILCHIMP_API_KEY in Vercel.')
    }
    if (!res.ok) throw new MailchimpError(`Mailchimp returned an error (${res.status}).`)
    const body = await res.json()
    const page = Array.isArray(body.reports) ? body.reports : []
    reports.push(...page)
    offset += page.length
    if (page.length < PAGE_SIZE || offset >= Number(body.total_items || 0)) break
  }
  return reports.filter(r => r.send_time)
}

// Vercel Cron runs in UTC, so vercel.json schedules both 19:00 and 20:00 UTC on
// Sunday. Only the one that is 8am Monday in Auckland (NZDT or NZST) runs.
export function isMondayEightAmInAuckland(instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const weekday = parts.find(p => p.type === 'weekday').value
  const hour = Number(parts.find(p => p.type === 'hour').value)
  return weekday === 'Mon' && hour === 8
}
