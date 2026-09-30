// Totals for each Marketing section. Pure functions over the rows the page
// loads, so the page, the tests and any later export all agree.

import { ALL_MONTHS, monthOfDate, monthOfTimestamp } from './months.js'

export const ACCOUNTS = ['spoke', 'ed']
export const ACCOUNT_LABELS = { spoke: 'Spoke page', ed: 'Ed' }

function inMonth(month, rowMonth) {
  return month === ALL_MONTHS || rowMonth === month
}

function average(values) {
  if (values.length === 0) return null
  return values.reduce((sum, v) => sum + Number(v), 0) / values.length
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0)
}

// ─── Email ──────────────────────────────────────────────────────────────────

export function campaignsInMonth(campaigns, month) {
  return campaigns
    .filter(c => inMonth(month, monthOfTimestamp(c.send_time)))
    .sort((a, b) => (a.send_time < b.send_time ? 1 : -1))
}

// Averages are a simple average of each campaign's rate, as Mailchimp shows.
export function emailTotals(campaigns) {
  return {
    campaigns: campaigns.length,
    avgOpenRate: average(campaigns.map(c => c.open_rate)),
    avgClickRate: average(campaigns.map(c => c.click_rate)),
    avgClickToOpen: average(campaigns.map(c => c.click_to_open)),
    replies: sum(campaigns, 'replies'),
    enquiries: sum(campaigns, 'enquiries'),
  }
}

// ─── LinkedIn ───────────────────────────────────────────────────────────────

function accountMatches(filter, account) {
  return filter === 'both' || filter === account
}

export function postsInView(posts, month, accountFilter) {
  return posts
    .filter(p => inMonth(month, monthOfDate(p.posted_on)) && accountMatches(accountFilter, p.account))
    .sort((a, b) => (a.posted_on < b.posted_on ? 1 : a.posted_on > b.posted_on ? -1 : 0))
}

// Follower rows for one platform, newest first, each with the change since
// the same account's previous logged month (null for the first one).
export function followerRowsWithChange(followers) {
  const oldestFirst = [...followers].sort((a, b) => (a.month < b.month ? -1 : 1))
  const previousByAccount = new Map()
  const withChange = oldestFirst.map(row => {
    const previous = previousByAccount.get(row.account)
    previousByAccount.set(row.account, row)
    return { ...row, change: previous ? row.followers - previous.followers : null }
  })
  return withChange.sort((a, b) =>
    a.month < b.month ? 1 : a.month > b.month ? -1 : ACCOUNTS.indexOf(a.account) - ACCOUNTS.indexOf(b.account)
  )
}

// The latest count on or before the selected month for one account.
export function latestFollowers(rowsWithChange, account, month) {
  const limit = month === ALL_MONTHS ? null : `${month}-01`
  const row = rowsWithChange.find(r => r.account === account && (limit === null || r.month <= limit))
  return row ? { followers: row.followers, change: row.change, month: row.month } : null
}

export function linkedinTotals(posts, rowsWithChange, month, accountFilter) {
  const likes = sum(posts, 'likes')
  const accounts = ACCOUNTS.filter(a => accountMatches(accountFilter, a))
  const followers = {}
  for (const account of accounts) {
    followers[account] = latestFollowers(rowsWithChange, account, month)
  }
  return {
    posts: posts.length,
    postsByAccount: {
      spoke: posts.filter(p => p.account === 'spoke').length,
      ed: posts.filter(p => p.account === 'ed').length,
    },
    likes,
    comments: sum(posts, 'comments'),
    avgLikes: posts.length === 0 ? null : likes / posts.length,
    followers,
  }
}

// ─── Website ────────────────────────────────────────────────────────────────

const LINKEDIN_RE = /linkedin|lnkd\.in/i
const MAILCHIMP_RE = /mailchimp|mailchi\.mp|list-manage\.com|mcusercontent/i

export function isLinkedInReferrer(site) {
  return LINKEDIN_RE.test(site)
}

export function isMailchimpReferrer(site) {
  return MAILCHIMP_RE.test(site)
}

// A week belongs to the month its Monday falls in.
export function weeksInMonth(weeks, month) {
  return weeks
    .filter(w => inMonth(month, monthOfDate(w.week_start)))
    .sort((a, b) => (a.week_start < b.week_start ? 1 : -1))
}

export function webTotals(weeks) {
  let fromLinkedIn = 0
  let fromMailchimp = 0
  const pageViews = new Map()
  for (const week of weeks) {
    for (const ref of week.top_referrers || []) {
      if (isLinkedInReferrer(ref.site)) fromLinkedIn += Number(ref.visitors || 0)
      else if (isMailchimpReferrer(ref.site)) fromMailchimp += Number(ref.visitors || 0)
    }
    for (const page of week.top_pages || []) {
      pageViews.set(page.path, (pageViews.get(page.path) || 0) + Number(page.views || 0))
    }
  }
  let topPage = null
  for (const [path, views] of pageViews) {
    if (topPage === null || views > topPage.views) topPage = { path, views }
  }
  return {
    visitors: sum(weeks, 'visitors'),
    pageViews: sum(weeks, 'page_views'),
    fromLinkedIn,
    fromMailchimp,
    topPage,
  }
}
