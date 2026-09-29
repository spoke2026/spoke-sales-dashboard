import { describe, it, expect, vi } from 'vitest'
import {
  monthOptions, parseMonthParam, monthOfTimestamp, monthLabel, mondayOf, isMonday,
} from './months.js'
import {
  campaignsInMonth, emailTotals, postsInView, followerRowsWithChange, latestFollowers,
  linkedinTotals, weeksInMonth, webTotals,
} from './totals.js'
import { dataCenterOf, reportToRow, fetchReports, isMondayEightAmInAuckland, MailchimpError } from './mailchimp.js'
import { runMailchimpSync } from './sync.js'
import {
  validatePost, validateFollower, validateWebWeek, validateCampaignManual, parsePairs, formatPairs, toCount,
} from './validate.js'
import { formatPercent, formatChange, formatCount, formatDateTime, formatSendDate } from './format.js'

// The one campaign since 1 September 2026, as Mailchimp's /3.0/reports returns it.
const RSE_REPORT = {
  id: 'abc123',
  campaign_title: 'RSEs Arriving soon!',
  subject_line: 'RSEs coming? Get their gear sorted now',
  emails_sent: 208,
  send_time: '2026-09-22T21:00:00+00:00', // 9am 23 Sep NZST... NZDT starts 27 Sep
  opens: { unique_opens: 76, open_rate: 0.37438423645320196 },
  clicks: { unique_subscriber_clicks: 2, click_rate: 0.009852216748768473 },
}

describe('months', () => {
  it('lists every month from September 2026 to now', () => {
    expect(monthOptions(new Date('2026-09-29T00:00:00Z'))).toEqual(['2026-09'])
    expect(monthOptions(new Date('2027-01-05T00:00:00Z'))).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'])
  })
  it('never lists fewer than September 2026', () => {
    expect(monthOptions(new Date('2026-06-01T00:00:00Z'))).toEqual(['2026-09'])
  })
  it('falls back to all months for anything unknown', () => {
    expect(parseMonthParam('2026-09', ['2026-09'])).toBe('2026-09')
    expect(parseMonthParam('2026-08', ['2026-09'])).toBe('all')
    expect(parseMonthParam(undefined, ['2026-09'])).toBe('all')
  })
  it('puts timestamps in their Auckland month', () => {
    expect(monthOfTimestamp('2026-09-30T19:00:00Z')).toBe('2026-10')
    expect(monthLabel('2026-09')).toBe('September 2026')
    expect(monthLabel('all')).toBe('All months')
  })
  it('finds Mondays', () => {
    expect(mondayOf('2026-09-29')).toBe('2026-09-28')
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
    expect(mondayOf('2026-10-04')).toBe('2026-09-28')
    expect(isMonday('2026-09-28')).toBe(true)
    expect(isMonday('2026-09-29')).toBe(false)
  })
})

describe('mailchimp', () => {
  it('reads the data centre from the key', () => {
    expect(dataCenterOf('0123abcd-us21')).toBe('us21')
    expect(() => dataCenterOf('nope')).toThrow(MailchimpError)
    expect(() => dataCenterOf(undefined)).toThrow(MailchimpError)
  })

  it('maps the RSE campaign to the brief figures', () => {
    const row = reportToRow(RSE_REPORT, '2026-09-29T00:00:00Z')
    expect(row).toMatchObject({
      mailchimp_id: 'abc123',
      campaign_name: 'RSEs Arriving soon!',
      subject_line: 'RSEs coming? Get their gear sorted now',
      recipients: 208,
      unique_opens: 76,
      unique_clicks: 2,
    })
    expect(formatPercent(row.open_rate)).toBe('37.4%')
    expect(formatPercent(row.click_rate)).toBe('1.0%')
    expect(formatPercent(row.click_to_open)).toBe('2.6%')
    expect(formatSendDate(row.send_time)).toBe('23 Sep 2026')
  })

  it('never includes replies or enquiries in a synced row', () => {
    const row = reportToRow(RSE_REPORT, 'x')
    expect(row).not.toHaveProperty('replies')
    expect(row).not.toHaveProperty('enquiries')
  })

  it('copes with a campaign nobody opened', () => {
    const row = reportToRow({ id: 1, send_time: 't' }, 'x')
    expect(row.click_to_open).toBe(0)
    expect(row.recipients).toBe(0)
    expect(row.campaign_name).toBe('')
  })

  it('pages through reports with the key as basic auth', async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => ({ ...RSE_REPORT, id: `a${i}` }))
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ reports: pageOne, total_items: 101 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ reports: [RSE_REPORT], total_items: 101 }) })
    const reports = await fetchReports({ apiKey: 'key-us21', fetchImpl })
    expect(reports).toHaveLength(101)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toContain('https://us21.api.mailchimp.com/3.0/reports?')
    expect(url).toContain('since_send_time=2026-09-01T00%3A00%3A00%2B12%3A00')
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('spoke:key-us21').toString('base64')}`)
    expect(fetchImpl.mock.calls[1][0]).toContain('offset=100')
  })

  it('explains a rejected key and other failures', async () => {
    await expect(fetchReports({ apiKey: 'k-us1', fetchImpl: async () => ({ ok: false, status: 401 }) }))
      .rejects.toThrow('rejected the API key')
    await expect(fetchReports({ apiKey: 'k-us1', fetchImpl: async () => ({ ok: false, status: 500 }) }))
      .rejects.toThrow('(500)')
    await expect(fetchReports({ apiKey: 'k-us1', fetchImpl: async () => { throw new Error('down') } }))
      .rejects.toThrow("Couldn't reach Mailchimp")
  })

  it('runs the cron only at 8am Monday Auckland time, across daylight saving', () => {
    // NZDT (UTC+13): Monday 5 Oct 2026 08:00 = Sunday 4 Oct 19:00 UTC
    expect(isMondayEightAmInAuckland(new Date('2026-10-04T19:00:00Z'))).toBe(true)
    expect(isMondayEightAmInAuckland(new Date('2026-10-04T20:00:00Z'))).toBe(false)
    // NZST (UTC+12): Monday 7 Jun 2027 08:00 = Sunday 6 Jun 20:00 UTC
    expect(isMondayEightAmInAuckland(new Date('2027-06-06T20:00:00Z'))).toBe(true)
    expect(isMondayEightAmInAuckland(new Date('2027-06-06T19:00:00Z'))).toBe(false)
  })
})

function fakeAdmin({ upsertError = null, logError = null } = {}) {
  const calls = { upserts: [], logUpdates: [] }
  const admin = {
    from(table) {
      if (table === 'mkt_sync_log') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: logError ? null : { id: 7 }, error: logError }) }) }),
          update: values => ({ eq: async () => { calls.logUpdates.push(values); return { error: null } } }),
        }
      }
      return { upsert: async (rows, opts) => { calls.upserts.push({ rows, opts }); return { error: upsertError } } }
    },
  }
  return { admin, calls }
}

describe('runMailchimpSync', () => {
  const okFetch = async () => ({ ok: true, status: 200, json: async () => ({ reports: [RSE_REPORT], total_items: 1 }) })

  it('upserts by mailchimp_id and logs success', async () => {
    const { admin, calls } = fakeAdmin()
    const result = await runMailchimpSync({ admin, apiKey: 'k-us21', trigger: 'button', fetchImpl: okFetch })
    expect(result).toEqual({ ok: true, campaigns: 1 })
    expect(calls.upserts[0].opts).toEqual({ onConflict: 'mailchimp_id' })
    expect(calls.upserts[0].rows[0]).not.toHaveProperty('replies')
    expect(calls.logUpdates[0]).toMatchObject({ ok: true, campaigns: 1, error: null })
  })

  it('logs a missing key', async () => {
    const { admin, calls } = fakeAdmin()
    const result = await runMailchimpSync({ admin, apiKey: '', trigger: 'cron', fetchImpl: okFetch })
    expect(result.ok).toBe(false)
    expect(calls.logUpdates[0].error).toContain('MAILCHIMP_API_KEY')
  })

  it('logs database and Mailchimp failures', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = fakeAdmin({ upsertError: { message: 'x' } })
    expect((await runMailchimpSync({ admin: db.admin, apiKey: 'k-us1', trigger: 'cron', fetchImpl: okFetch })).ok).toBe(false)
    const mc = fakeAdmin()
    const res = await runMailchimpSync({ admin: mc.admin, apiKey: 'k-us1', trigger: 'cron', fetchImpl: async () => ({ ok: false, status: 401 }) })
    expect(res.error).toContain('rejected')
    const log = fakeAdmin({ logError: { message: 'x' } })
    expect((await runMailchimpSync({ admin: log.admin, apiKey: 'k-us1', trigger: 'cron', fetchImpl: okFetch })).ok).toBe(false)
    spy.mockRestore()
  })
})

describe('email totals', () => {
  const campaigns = [
    { send_time: '2026-09-22T21:00:00Z', open_rate: 0.4, click_rate: 0.01, click_to_open: 0.025, replies: 1, enquiries: 2 },
    { send_time: '2026-10-06T21:00:00Z', open_rate: 0.3, click_rate: 0.03, click_to_open: 0.1, replies: 0, enquiries: 1 },
  ]
  it('filters by month and averages rates', () => {
    expect(campaignsInMonth(campaigns, '2026-09')).toHaveLength(1)
    const t = emailTotals(campaignsInMonth(campaigns, 'all'))
    expect(t.campaigns).toBe(2)
    expect(t.avgOpenRate).toBeCloseTo(0.35)
    expect(t.replies).toBe(1)
    expect(t.enquiries).toBe(3)
  })
  it('has no averages for an empty month', () => {
    expect(emailTotals([]).avgOpenRate).toBeNull()
  })
})

describe('linkedin totals', () => {
  const posts = [
    { account: 'spoke', posted_on: '2026-09-10', likes: 10, comments: 1 },
    { account: 'ed', posted_on: '2026-09-20', likes: 30, comments: 4 },
    { account: 'ed', posted_on: '2026-10-02', likes: 5, comments: 0 },
  ]
  const followers = followerRowsWithChange([
    { id: 1, account: 'spoke', month: '2026-09-01', followers: 400 },
    { id: 2, account: 'spoke', month: '2026-10-01', followers: 420 },
    { id: 3, account: 'ed', month: '2026-09-01', followers: 1500 },
  ])

  it('works out the change since the previous month', () => {
    expect(followers.map(f => [f.id, f.change])).toEqual([[2, 20], [1, null], [3, null]])
  })

  it('totals posts for the month and account', () => {
    const shown = postsInView(posts, '2026-09', 'both')
    const t = linkedinTotals(shown, followers, '2026-09', 'both')
    expect(t.posts).toBe(2)
    expect(t.postsByAccount).toEqual({ spoke: 1, ed: 1 })
    expect(t.likes).toBe(40)
    expect(t.avgLikes).toBe(20)
    expect(t.followers.spoke).toEqual({ followers: 400, change: null, month: '2026-09-01' })
    expect(postsInView(posts, 'all', 'ed')).toHaveLength(2)
  })

  it('uses the latest count on or before the month', () => {
    expect(latestFollowers(followers, 'spoke', 'all').followers).toBe(420)
    expect(latestFollowers(followers, 'ed', '2026-10').followers).toBe(1500)
    expect(latestFollowers(followers, 'ed', '2026-08')).toBeNull()
    const onlyEd = linkedinTotals([], followers, 'all', 'ed')
    expect(Object.keys(onlyEd.followers)).toEqual(['ed'])
    expect(onlyEd.avgLikes).toBeNull()
  })
})

describe('website totals', () => {
  const weeks = [
    {
      week_start: '2026-09-21', visitors: 100, page_views: 250,
      top_pages: [{ path: '/', views: 120 }, { path: '/contact', views: 20 }],
      top_referrers: [{ site: 'linkedin.com', visitors: 12 }, { site: 'lnkd.in', visitors: 3 }, { site: 'mailchi.mp', visitors: 5 }, { site: 'google.com', visitors: 30 }],
    },
    {
      week_start: '2026-09-28', visitors: 80, page_views: 150,
      top_pages: [{ path: '/contact', views: 110 }],
      top_referrers: [{ site: 'us21.list-manage.com', visitors: 2 }],
    },
    { week_start: '2026-10-05', visitors: 1, page_views: 1, top_pages: [], top_referrers: [] },
  ]
  it('adds up the month and picks the top page', () => {
    const t = webTotals(weeksInMonth(weeks, '2026-09'))
    expect(t).toEqual({ visitors: 180, pageViews: 400, fromLinkedIn: 15, fromMailchimp: 7, topPage: { path: '/contact', views: 130 } })
  })
  it('has no top page with no weeks', () => {
    expect(webTotals([]).topPage).toBeNull()
  })
})

describe('validation', () => {
  it('checks posts', () => {
    const ok = validatePost({ account: 'ed', posted_on: '2026-09-20', topic: ' Hi ', likes: '1,200', comments: 3, url: '' })
    expect(ok.value).toEqual({ platform: 'linkedin', account: 'ed', posted_on: '2026-09-20', topic: 'Hi', likes: 1200, comments: 3, url: null })
    expect(validatePost({ account: 'bob' }).field).toBe('account')
    expect(validatePost({ account: 'ed', posted_on: '2026-02-30' }).field).toBe('posted_on')
    expect(validatePost({ account: 'ed', posted_on: '2026-09-20', topic: '' }).field).toBe('topic')
    expect(validatePost({ account: 'ed', posted_on: '2026-09-20', topic: 'x', likes: -1 }).field).toBe('likes')
    expect(validatePost({ account: 'ed', posted_on: '2026-09-20', topic: 'x', url: 'javascript:alert(1)' }).field).toBe('url')
    expect(validatePost({ platform: 'myspace' }).field).toBe('platform')
  })
  it('checks follower counts', () => {
    expect(validateFollower({ account: 'spoke', month: '2026-09', followers: '420' }).value)
      .toEqual({ platform: 'linkedin', account: 'spoke', month: '2026-09-01', followers: 420 })
    expect(validateFollower({ account: 'spoke', month: '2026-13', followers: 1 }).field).toBe('month')
    expect(validateFollower({ account: 'spoke', month: '2026-09', followers: 'lots' }).field).toBe('followers')
  })
  it('checks website weeks', () => {
    const ok = validateWebWeek({ week_start: '2026-09-28', visitors: '80', page_views: 150, top_pages: [{ path: '/', views: '3' }] })
    expect(ok.value.top_pages).toEqual([{ path: '/', views: 3 }])
    expect(ok.value.top_referrers).toEqual([])
    expect(validateWebWeek({ week_start: '2026-09-29' }).field).toBe('week_start')
    expect(validateWebWeek({ week_start: '2026-09-28', top_pages: 'x' }).field).toBe('top_pages')
    expect(validateWebWeek({ week_start: '2026-09-28', top_referrers: [{ site: '', visitors: 1 }] }).field).toBe('top_referrers')
  })
  it('checks replies and enquiries', () => {
    expect(validateCampaignManual({ replies: '2', enquiries: 0 }).value).toEqual({ replies: 2, enquiries: 0 })
    expect(validateCampaignManual({ replies: 1.5 }).field).toBe('replies')
    expect(validateCampaignManual({ replies: 1, enquiries: 'x' }).field).toBe('enquiries')
  })
  it('reads one-per-line lists and writes them back', () => {
    const parsed = parsePairs('/ 120\n\nlinkedin.com, 1,200\n/page2 5', 'path', 'views')
    expect(parsed.value).toEqual([{ path: '/', views: 120 }, { path: 'linkedin.com', views: 1200 }, { path: '/page2', views: 5 }])
    expect(parsePairs('/ 120\njust words', 'path', 'views')).toMatchObject({ line: 2 })
    expect(formatPairs([{ path: '/', views: 3 }], 'path', 'views')).toBe('/ 3')
    expect(toCount(null)).toBeNull()
    expect(toCount(3.5)).toBeNull()
  })
})

describe('format', () => {
  it('formats numbers and changes', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(null)).toBe('None yet')
    expect(formatChange(null)).toBe('First count')
    expect(formatChange(0)).toBe('No change')
    expect(formatChange(12)).toBe('+12')
    expect(formatChange(-3)).toBe('-3')
  })
  it('shows Auckland time', () => {
    expect(formatDateTime('2026-09-28T19:04:00Z')).toBe('29 Sep 2026, 8:04am')
    expect(formatDateTime('2026-09-29T00:30:00Z')).toBe('29 Sep 2026, 1:30pm')
    expect(formatDateTime('2026-09-28T11:05:00Z')).toBe('29 Sep 2026, 12:05am')
  })
})
