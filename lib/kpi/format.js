// Display labels for 'YYYY-MM-DD' dates. One copy, used by the KPI pages, the
// admin panels and the closures route. Fixed English names rather than Intl:
// en-NZ gives "Sept", and the server (Node) and browser ICU data can differ,
// which would break hydration. UTC getters only, so the host time zone never
// matters.

import { todayInAuckland } from './calendar.js'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function utc(date) {
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))))
}

// 'Fri 10 Jul'
export function formatDayMonth(date) {
  const d = utc(date)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`
}

// 'Mon 28 Dec 2026'
export function formatDayMonthYear(date) {
  return `${formatDayMonth(date)} ${date.slice(0, 4)}`
}

// '1 April 2025'
export function formatLongDate(date) {
  const d = utc(date)
  return `${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// 'September 2026'
export function formatMonthYear(date) {
  return `${MONTHS_LONG[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
}

// Saturday or Sunday, for display filtering only. Working-day truth comes
// from kpi_calendar_day, never from this.
export function isWeekend(date) {
  const day = utc(date).getUTCDay()
  return day === 0 || day === 6
}

// Formats a timestamp (an ISO instant, e.g. a Postgres timestamptz) as the NZ
// calendar date it falls on, 'Thu 24 Sep 2026'. todayInAuckland is the only
// place an instant becomes a date (0+1 rule), so this converts through it
// rather than reading UTC fields directly. Never throws: an unreadable value
// returns 'Date unreadable' rather than a wrong date (rule 8).
export function formatTimestampDate(ts) {
  if (typeof ts !== 'string') return 'Date unreadable'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return 'Date unreadable'
  return formatDayMonthYear(todayInAuckland(d))
}
