// Pure date and calendar helpers for the KPI engine.
//
// Dates are 'YYYY-MM-DD' strings throughout. All arithmetic runs on UTC-midnight
// milliseconds (Date.UTC and getUTC*), so the host time zone never matters.
// todayInAuckland is the only place a real-world instant becomes a calendar
// date. Working-day truth comes only from kpi_calendar_day rows; nothing here
// knows about weekdays or holidays.

export class KpiEngineError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'KpiEngineError'
    this.code = code
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86400000
const PHASINGS = ['working_days', 'calendar_days']

function toMs(date) {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

function fromMs(ms) {
  const d = new Date(ms)
  const y = String(d.getUTCFullYear()).padStart(4, '0')
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE.test(s)) return false
  return fromMs(toMs(s)) === s
}

export function addDays(date, n) {
  return fromMs(toMs(date) + n * DAY_MS)
}

export function monthStartOf(date) {
  return `${date.slice(0, 7)}-01`
}

export function monthEndOf(date) {
  // Day 0 of the next month is the last day of this one.
  return fromMs(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0))
}

export function daysInMonth(date) {
  return Number(monthEndOf(date).slice(8, 10))
}

export function eachDate(start, end) {
  const out = []
  for (let ms = toMs(start); ms <= toMs(end); ms += DAY_MS) out.push(fromMs(ms))
  return out
}

const AUCKLAND = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Pacific/Auckland',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function todayInAuckland(instant = new Date()) {
  const parts = AUCKLAND.formatToParts(instant)
  const part = type => parts.find(p => p.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function indexCalendar(rows) {
  if (!Array.isArray(rows)) {
    throw new KpiEngineError('INVALID_CALENDAR', 'The calendar must be an array of rows.')
  }
  const map = new Map()
  for (const row of rows) {
    if (row === null || typeof row !== 'object' || !isIsoDate(row.date)) {
      throw new KpiEngineError('INVALID_CALENDAR', 'A calendar row has no valid date.')
    }
    if (row.is_working_day !== true && row.is_working_day !== false) {
      throw new KpiEngineError('INVALID_CALENDAR', `Calendar row ${row.date} has no true or false working-day flag.`)
    }
    if (map.has(row.date)) {
      throw new KpiEngineError('INVALID_CALENDAR', `Calendar date ${row.date} appears twice.`)
    }
    map.set(row.date, row.is_working_day)
  }
  return map
}

export function countTargetDays({ calendar, phasing, start, end }) {
  if (!PHASINGS.includes(phasing)) {
    throw new KpiEngineError('INVALID_INPUT', `Unknown phasing ${phasing}.`)
  }
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw new KpiEngineError('INVALID_INPUT', 'Start and end must be YYYY-MM-DD dates.')
  }
  if (start > end) return 0
  if (phasing === 'calendar_days') {
    return (toMs(end) - toMs(start)) / DAY_MS + 1
  }
  const map = calendar instanceof Map ? calendar : indexCalendar(calendar)
  let count = 0
  for (const date of eachDate(start, end)) {
    const flag = map.get(date)
    if (flag === undefined) {
      throw new KpiEngineError('CALENDAR_GAP', `The working-day calendar has no row for ${date}.`)
    }
    if (flag === true) count++
  }
  return count
}
