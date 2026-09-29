// Month helpers for the Marketing tab. Months are 'YYYY-MM' strings and every
// timestamp is placed in its Auckland month, so a campaign sent at 7am on
// 1 October NZ time counts in October even though it is still 30 September UTC.

import { todayInAuckland } from '../kpi/calendar.js'

export const FIRST_MONTH = '2026-09'
export const ALL_MONTHS = 'all'

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function isMonth(value) {
  return typeof value === 'string' && MONTH_RE.test(value)
}

function nextMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

// Every month from September 2026 to this Auckland month, oldest first.
export function monthOptions(instant = new Date()) {
  const current = todayInAuckland(instant).slice(0, 7)
  const months = [FIRST_MONTH]
  while (months[months.length - 1] < current) {
    months.push(nextMonth(months[months.length - 1]))
  }
  return months
}

export function parseMonthParam(raw, options) {
  return isMonth(raw) && options.includes(raw) ? raw : ALL_MONTHS
}

export function monthOfTimestamp(timestamp) {
  return todayInAuckland(new Date(timestamp)).slice(0, 7)
}

export function monthOfDate(isoDate) {
  return isoDate.slice(0, 7)
}

export function monthLabel(month) {
  if (month === ALL_MONTHS) return 'All months'
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${y}`
}

export function shortMonthLabel(month) {
  if (month === ALL_MONTHS) return 'All months'
  const [y, m] = month.split('-').map(Number)
  return `${MONTH_NAMES[m - 1].slice(0, 3)} ${y}`
}

// The Monday on or before an ISO date.
export function mondayOf(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export function isMonday(isoDate) {
  return /^\d{4}-\d{2}-\d{2}$/.test(isoDate) && mondayOf(isoDate) === isoDate
}
