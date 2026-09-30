// Input checks for the Marketing API routes, and the "one per line" parser the
// website form uses. Each validator returns { value } on success or
// { error, field } with a message written for the person typing.

import { isMonday, isMonth } from './months.js'

export const PLATFORMS = ['linkedin', 'instagram', 'facebook']
const ACCOUNTS = ['spoke', 'ed']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_COUNT = 100000000

function fail(field, error) {
  return { field, error }
}

function isRealDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// Whole numbers from 0 up. Accepts numbers or numeric strings ("1,200" too).
export function toCount(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : null
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/,/g, '').trim()
  if (!/^\d+$/.test(cleaned)) return null
  const n = Number(cleaned)
  return n <= MAX_COUNT ? n : null
}

function countField(body, field, label) {
  const n = toCount(body[field] ?? 0)
  return n === null ? fail(field, `${label} must be a whole number, 0 or more.`) : { value: n }
}

export function validateCampaignManual(body) {
  const replies = countField(body, 'replies', 'Replies')
  if (replies.error) return replies
  const enquiries = countField(body, 'enquiries', 'Enquiries')
  if (enquiries.error) return enquiries
  return { value: { replies: replies.value, enquiries: enquiries.value } }
}

export function validatePost(body) {
  const platform = body.platform ?? 'linkedin'
  if (!PLATFORMS.includes(platform)) return fail('platform', 'Choose a platform.')
  if (!ACCOUNTS.includes(body.account)) return fail('account', 'Choose the Spoke page or Ed.')
  if (!isRealDate(body.posted_on)) return fail('posted_on', 'Enter the date it was posted.')
  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  if (topic.length === 0) return fail('topic', 'Say what the post was about.')
  if (topic.length > 500) return fail('topic', 'Keep this under 500 characters.')
  const likes = countField(body, 'likes', 'Likes')
  if (likes.error) return likes
  const comments = countField(body, 'comments', 'Comments')
  if (comments.error) return comments
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  if (url !== '' && !/^https?:\/\/\S+$/i.test(url)) return fail('url', 'Links must start with https://')
  return {
    value: {
      platform,
      account: body.account,
      posted_on: body.posted_on,
      topic,
      likes: likes.value,
      comments: comments.value,
      url: url === '' ? null : url,
    },
  }
}

export function validateFollower(body) {
  const platform = body.platform ?? 'linkedin'
  if (!PLATFORMS.includes(platform)) return fail('platform', 'Choose a platform.')
  if (!ACCOUNTS.includes(body.account)) return fail('account', 'Choose the Spoke page or Ed.')
  if (!isMonth(body.month)) return fail('month', 'Choose a month.')
  const followers = toCount(body.followers)
  if (followers === null) return fail('followers', 'Followers must be a whole number, 0 or more.')
  return { value: { platform, account: body.account, month: `${body.month}-01`, followers } }
}

function validatePairs(list, keyName, numName, field, label) {
  if (!Array.isArray(list)) return fail(field, `${label} must be a list.`)
  if (list.length > 50) return fail(field, `Keep ${label.toLowerCase()} to 50 lines or fewer.`)
  const clean = []
  for (const item of list) {
    const key = typeof item?.[keyName] === 'string' ? item[keyName].trim() : ''
    const num = toCount(item?.[numName])
    if (key === '' || key.length > 300 || num === null) {
      return fail(field, `Each line in ${label.toLowerCase()} needs a name and a whole number.`)
    }
    clean.push({ [keyName]: key, [numName]: num })
  }
  return { value: clean }
}

export function validateWebWeek(body) {
  if (!isRealDate(body.week_start) || !isMonday(body.week_start)) {
    return fail('week_start', 'Choose the Monday the week starts on.')
  }
  const visitors = countField(body, 'visitors', 'Visitors')
  if (visitors.error) return visitors
  const pageViews = countField(body, 'page_views', 'Page views')
  if (pageViews.error) return pageViews
  const pages = validatePairs(body.top_pages ?? [], 'path', 'views', 'top_pages', 'Top pages')
  if (pages.error) return pages
  const referrers = validatePairs(body.top_referrers ?? [], 'site', 'visitors', 'top_referrers', 'Top referrers')
  if (referrers.error) return referrers
  return {
    value: {
      week_start: body.week_start,
      visitors: visitors.value,
      page_views: pageViews.value,
      top_pages: pages.value,
      top_referrers: referrers.value,
    },
  }
}

// "/ 120" or "linkedin.com, 12" per line → [{ path: '/', views: 120 }].
// Returns { value } or { error, line } for the first line it can't read.
export function parsePairs(text, keyName, numName) {
  const value = []
  const lines = String(text || '').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    const match = line.match(/^(.*?)[\s,]+([\d,]+)$/)
    const num = match ? toCount(match[2]) : null
    const key = match ? match[1].replace(/[\s,]+$/, '').trim() : ''
    if (!match || key === '' || num === null) return { error: `Line ${i + 1} needs a name then a number, like "/contact 42".`, line: i + 1 }
    value.push({ [keyName]: key, [numName]: num })
  }
  return { value }
}

export function formatPairs(list, keyName, numName) {
  return (list || []).map(item => `${item[keyName]} ${item[numName]}`).join('\n')
}
