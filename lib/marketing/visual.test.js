import { describe, it, expect } from 'vitest'
import {
  dayMonth, previousMonth, marketingVisitors, weeklySeries, visitorChange, share,
  campaignSeries, monthlyResponses, postSeries, followerSeries,
} from './visual.js'

const weeks = [
  { week_start: '2026-10-05', visitors: 60, top_referrers: [{ site: 'linkedin.com', visitors: 5 }, { site: 'mailchi.mp', visitors: 3 }, { site: 'google.com', visitors: 9 }] },
  { week_start: '2026-09-28', visitors: 40, top_referrers: [] },
  { week_start: '2026-09-21', visitors: 20 },
]

describe('visual series', () => {
  it('labels dates and months', () => {
    expect(dayMonth('2026-09-28')).toBe('28 Sep')
    expect(previousMonth('2026-10')).toBe('2026-09')
    expect(previousMonth('2027-01')).toBe('2026-12')
  })

  it('counts LinkedIn and Mailchimp visitors for a week', () => {
    expect(marketingVisitors(weeks[0])).toBe(8)
    expect(marketingVisitors(weeks[2])).toBe(0)
  })

  it('charts weeks up to the selected month, oldest first', () => {
    expect(weeklySeries(weeks, '2026-09')).toEqual({ labels: ['21 Sep', '28 Sep'], visitors: [20, 40], fromMarketing: [0, 0] })
    expect(weeklySeries(weeks, 'all').labels).toEqual(['21 Sep', '28 Sep', '5 Oct'])
    const many = Array.from({ length: 20 }, (_, i) => ({ week_start: `2027-0${1 + Math.floor(i / 5)}-0${1 + (i % 5)}`, visitors: i }))
    expect(weeklySeries(many, 'all').labels).toHaveLength(12)
  })

  it('compares visitors with last month', () => {
    expect(visitorChange(weeks, '2026-10')).toEqual({ pct: 0, versus: 'Sep 2026' })
    expect(visitorChange([...weeks, { week_start: '2026-10-12', visitors: 30 }], '2026-10')).toEqual({ pct: 50, versus: 'Sep 2026' })
    expect(visitorChange(weeks, '2026-09')).toBeNull()
    expect(visitorChange(weeks, 'all')).toBeNull()
  })

  it('works out a share safely', () => {
    expect(share(1, 4)).toBe(0.25)
    expect(share(1, 0)).toBeNull()
  })

  it('orders campaigns and posts oldest first', () => {
    const c = campaignSeries([
      { send_time: '2026-10-01T00:00:00Z', campaign_name: 'B', open_rate: 0.3 },
      { send_time: '2026-09-22T21:00:00Z', campaign_name: '', open_rate: 0.37438 },
    ])
    expect(c).toEqual({ labels: ['Campaign', 'B'], openRates: [37.4, 30] })
    expect(postSeries([{ posted_on: '2026-09-24', likes: 41 }, { posted_on: '2026-09-15', likes: '14' }]))
      .toEqual({ labels: ['15 Sep', '24 Sep'], likes: [14, 41] })
  })

  it('totals responses by month', () => {
    const campaigns = [
      { send_time: '2026-09-22T21:00:00Z', enquiries: 2, replies: 1 },
      { send_time: '2026-10-06T21:00:00Z', enquiries: 1, replies: 0 },
    ]
    expect(monthlyResponses(campaigns, ['2026-09', '2026-10'], '2026-09')).toEqual({ labels: ['Sep'], enquiries: [2], replies: [1] })
    expect(monthlyResponses(campaigns, ['2026-09', '2026-10'], 'all').enquiries).toEqual([2, 1])
  })

  it('lines up follower counts by month with gaps', () => {
    const followers = [
      { account: 'spoke', month: '2026-09-01', followers: 400 },
      { account: 'ed', month: '2026-10-01', followers: 1600 },
    ]
    expect(followerSeries(followers, ['2026-09', '2026-10'], 'all')).toEqual({ labels: ['Sep', 'Oct'], spoke: [400, null], ed: [null, 1600] })
  })
})
