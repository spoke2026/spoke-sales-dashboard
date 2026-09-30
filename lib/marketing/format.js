// Display formatting for the Marketing tab. Hand-rolled rather than
// toLocaleString so the server render and the browser render always match.

import { todayInAuckland } from '../kpi/calendar.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatCount(value) {
  if (value === null || value === undefined) return 'None yet'
  return String(Math.round(Number(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function formatDecimal(value) {
  if (value === null || value === undefined) return 'None yet'
  return (Math.round(Number(value) * 10) / 10).toFixed(1)
}

// Fractions to one-decimal percentages: 0.374 → "37.4%".
export function formatPercent(fraction) {
  if (fraction === null || fraction === undefined) return 'None yet'
  return `${(Math.round(Number(fraction) * 1000) / 10).toFixed(1)}%`
}

export function formatChange(change) {
  if (change === null || change === undefined) return 'First count'
  if (change === 0) return 'No change'
  return change > 0 ? `+${formatCount(change)}` : `-${formatCount(-change)}`
}

// '2026-09-23' → '23 Sep 2026'
export function formatDate(isoDate) {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

// A timestamp shown as its Auckland date.
export function formatSendDate(timestamp) {
  return formatDate(todayInAuckland(new Date(timestamp)))
}

// A timestamp as '29 Sep 2026, 8:04am' in Auckland.
export function formatDateTime(timestamp) {
  const instant = new Date(timestamp)
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const hour = Number(parts.find(p => p.type === 'hour').value)
  const minute = parts.find(p => p.type === 'minute').value
  const suffix = hour < 12 ? 'am' : 'pm'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${formatDate(todayInAuckland(instant))}, ${hour12}:${minute}${suffix}`
}
