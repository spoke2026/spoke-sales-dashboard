// Series and headline figures for the Marketing dashboard cards and charts.
// Pure functions over the rows the page loads, like totals.js.

import { ALL_MONTHS, monthOfDate, monthOfTimestamp, shortMonthLabel } from './months.js'
import { isLinkedInReferrer, isMailchimpReferrer, ACCOUNTS } from './totals.js'

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const CHART_WEEKS = 12

// '2026-09-28' → '28 Sep'
export function dayMonth(isoDate) {
  const [, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return `${d} ${SHORT_MONTHS[m - 1]}`
}

export function previousMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function upToMonth(month, rowMonth) {
  return month === ALL_MONTHS || rowMonth <= month
}

export function marketingVisitors(week) {
  return (week.top_referrers || [])
    .filter(r => isLinkedInReferrer(r.site) || isMailchimpReferrer(r.site))
    .reduce((sum, r) => sum + Number(r.visitors || 0), 0)
}

// The last 12 weeks up to the end of the selected month, oldest first.
export function weeklySeries(weeks, month) {
  const shown = weeks
    .filter(w => upToMonth(month, monthOfDate(w.week_start)))
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
    .slice(-CHART_WEEKS)
  return {
    labels: shown.map(w => dayMonth(w.week_start)),
    visitors: shown.map(w => Number(w.visitors || 0)),
    fromMarketing: shown.map(marketingVisitors),
  }
}

// Visitors this month against last month, as a whole-number percentage.
// Null for All months, or when last month has no numbers to compare with.
export function visitorChange(weeks, month) {
  if (month === ALL_MONTHS) return null
  const total = m => weeks
    .filter(w => monthOfDate(w.week_start) === m)
    .reduce((sum, w) => sum + Number(w.visitors || 0), 0)
  const before = total(previousMonth(month))
  if (before === 0) return null
  return { pct: Math.round(((total(month) - before) / before) * 100), versus: shortMonthLabel(previousMonth(month)) }
}

export function share(part, whole) {
  return whole > 0 ? part / whole : null
}

// Open rate for each campaign in view, oldest first.
export function campaignSeries(campaigns) {
  const sorted = [...campaigns].sort((a, b) => (a.send_time < b.send_time ? -1 : 1))
  return {
    labels: sorted.map(c => c.campaign_name || 'Campaign'),
    openRates: sorted.map(c => Math.round(Number(c.open_rate) * 1000) / 10),
  }
}

// Enquiries and replies for each month up to the selected one.
export function monthlyResponses(campaigns, months, month) {
  const shown = months.filter(m => upToMonth(month, m))
  const sumFor = (m, key) => campaigns
    .filter(c => monthOfTimestamp(c.send_time) === m)
    .reduce((sum, c) => sum + Number(c[key] || 0), 0)
  return {
    labels: shown.map(m => shortMonthLabel(m).slice(0, 3)),
    enquiries: shown.map(m => sumFor(m, 'enquiries')),
    replies: shown.map(m => sumFor(m, 'replies')),
  }
}

// Likes for each post in view, oldest first.
export function postSeries(posts) {
  const sorted = [...posts].sort((a, b) => (a.posted_on < b.posted_on ? -1 : 1))
  return {
    labels: sorted.map(p => dayMonth(p.posted_on)),
    likes: sorted.map(p => Number(p.likes || 0)),
  }
}

// Follower counts by month for each account, null where nothing was logged.
export function followerSeries(followers, months, month) {
  const shown = months.filter(m => upToMonth(month, m))
  const series = {}
  for (const account of ACCOUNTS) {
    series[account] = shown.map(m => {
      const row = followers.find(f => f.account === account && f.month.slice(0, 7) === m)
      return row ? row.followers : null
    })
  }
  return { labels: shown.map(m => shortMonthLabel(m).slice(0, 3)), ...series }
}
