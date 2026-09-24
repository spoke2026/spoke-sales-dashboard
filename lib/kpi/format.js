// Display labels for 'YYYY-MM-DD' dates. One copy, used by the KPI pages, the
// admin panels and the closures route. Fixed English names rather than Intl:
// en-NZ gives "Sept", and the server (Node) and browser ICU data can differ,
// which would break hydration. UTC getters only, so the host time zone never
// matters.

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
