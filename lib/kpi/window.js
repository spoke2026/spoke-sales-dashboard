// The window selector (PRD 12.1, D12). Pure: no UI, database or network.
//
// This is the one implementation of parsing a `window` URL parameter,
// resolving it to a concrete { start, end } window against
// kpi_quarter_months() rows, and building the selector's chip links. No FY or
// quarter is ever computed from a JS date: 'This quarter' and 'This FY' are
// read off the fy/quarter/month rows the caller supplies (D12). Never mutates
// its inputs.

import { isIsoDate, addDays, monthStartOf, monthEndOf, KpiEngineError } from './calendar.js'
import { formatDayMonth, formatDayMonthYear, formatMonthYear, formatLongDate } from './format.js'
import { formatQuarter, formatQuarterMonths } from './scorecard.js'

const DAY_MS = 86400000
const M_RE = /^m-(\d{4})-(0[1-9]|1[0-2])$/
const Q_RE = /^q-(\d{4})-([1-4])$/
const FYX_RE = /^fy-(\d{4})$/
const SIMPLE_KINDS = new Set(['today', 'week', 'month', 'quarter', 'fy'])

export const WINDOW_NOTICES = Object.freeze({
  INVALID: "That window link isn't valid, so this shows this month.",
  NOT_STARTED: "That period hasn't started yet, so this shows this month.",
  RANGE_ORDER: 'The custom range starts after it ends, so this shows this month.',
  RANGE_LONG: 'Custom ranges can be up to 366 days, so this shows this month.',
  RANGE_CALENDAR: (start, end) =>
    `The working-day calendar covers ${formatLongDate(start)} to ${formatLongDate(end)}, so this shows this month.`,
})

function toMs(date) {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

function weekdayOf(date) {
  return new Date(toMs(date)).getUTCDay()
}

function daysBetween(start, end) {
  return (toMs(end) - toMs(start)) / DAY_MS
}

function fySuffix(fy) {
  return String(fy % 100).padStart(2, '0')
}

// An FY always spans two calendar years (April to March), so both months
// always show their year.
function monthsRangeLabel(months) {
  return `${formatMonthYear(months[0])} to ${formatMonthYear(months[months.length - 1])}`
}

function rangeLabelShort(start, end) {
  if (start.slice(0, 4) === end.slice(0, 4)) return `${formatDayMonth(start)} to ${formatDayMonthYear(end)}`
  return `${formatDayMonthYear(start)} to ${formatDayMonthYear(end)}`
}

function rangeLabelLong(start, end) {
  if (start === end) return formatDayMonthYear(start)
  return `${formatDayMonthYear(start)} to ${formatDayMonthYear(end)}`
}

// Groups kpi_quarter_months() rows into quarters, each with its sorted months.
// This only reshapes the rows the caller supplies; it never computes an FY or
// a quarter from a date (D12).
function groupQuarters(rows) {
  const byKey = new Map()
  for (const row of rows) {
    const key = `${row.fy}-${row.quarter}`
    let entry = byKey.get(key)
    if (entry === undefined) {
      entry = { fy: row.fy, quarter: row.quarter, months: [] }
      byKey.set(key, entry)
    }
    entry.months.push(row.month)
  }
  for (const entry of byKey.values()) entry.months.sort()
  return [...byKey.values()].sort((a, b) => a.fy - b.fy || a.quarter - b.quarter)
}

function groupFys(rows) {
  const byFy = new Map()
  for (const row of rows) {
    let months = byFy.get(row.fy)
    if (months === undefined) {
      months = []
      byFy.set(row.fy, months)
    }
    months.push(row.month)
  }
  for (const months of byFy.values()) months.sort()
  return [...byFy.entries()].sort((a, b) => a[0] - b[0]).map(([fy, months]) => ({ fy, months }))
}

// The Monday on or before date. UTC weekday, so the host time zone never
// matters (calendar.js's own rule).
export function weekStartOf(date) {
  const dow = weekdayOf(date)
  const sinceMonday = dow === 0 ? 6 : dow - 1
  return addDays(date, -sinceMonday)
}

export function parseWindowParams({ window, from, to }) {
  if (window === undefined) return { kind: 'default' }
  if (typeof window !== 'string') return { kind: 'invalid' }
  if (SIMPLE_KINDS.has(window)) return { kind: window }

  const m = M_RE.exec(window)
  if (m !== null) return { kind: 'm', month: `${m[1]}-${m[2]}-01` }

  const q = Q_RE.exec(window)
  if (q !== null) return { kind: 'q', fy: Number(q[1]), quarter: Number(q[2]) }

  const fyx = FYX_RE.exec(window)
  if (fyx !== null) return { kind: 'fyx', fy: Number(fyx[1]) }

  if (window === 'range') {
    if (isIsoDate(from) && isIsoDate(to)) return { kind: 'range', from, to }
    return { kind: 'invalid' }
  }

  return { kind: 'invalid' }
}

export function windowHref(basePath, selection) {
  const params = new URLSearchParams()
  if (selection.kind === 'today' || selection.kind === 'week' || selection.kind === 'quarter' || selection.kind === 'fy') {
    params.set('window', selection.kind)
  } else if (selection.kind === 'm') {
    params.set('window', `m-${selection.month.slice(0, 7)}`)
  } else if (selection.kind === 'q') {
    params.set('window', `q-${selection.fy}-${selection.quarter}`)
  } else if (selection.kind === 'fyx') {
    params.set('window', `fy-${selection.fy}`)
  } else if (selection.kind === 'range') {
    params.set('window', 'range')
    params.set('from', selection.from)
    params.set('to', selection.to)
  }
  const qs = params.toString()
  return qs === '' ? basePath : `${basePath}?${qs}`
}

function monthResolution(today, notice) {
  const start = monthStartOf(today)
  const end = monthEndOf(start)
  return {
    start,
    end,
    label: `This month, ${formatMonthYear(start)}`,
    chipKey: 'month',
    href: windowHref('', { kind: 'month' }),
    notice,
  }
}

function calendarBounds(quarterMonthRows) {
  const months = quarterMonthRows.map(r => r.month).sort()
  return { calendarStart: monthStartOf(months[0]), calendarEnd: monthEndOf(months[months.length - 1]) }
}

export function resolveWindow(parsed, today, quarterMonthRows) {
  const todayMonth = monthStartOf(today)
  const quarters = groupQuarters(quarterMonthRows)
  const fys = groupFys(quarterMonthRows)
  const allMonths = quarterMonthRows.map(r => r.month)
  const { calendarStart, calendarEnd } = calendarBounds(quarterMonthRows)

  if (!allMonths.includes(todayMonth)) {
    throw new KpiEngineError('CALENDAR_GAP', "The calendar has no row for today's month.")
  }

  const kind = parsed.kind === 'default' ? 'month' : parsed.kind

  if (kind === 'invalid') return monthResolution(today, WINDOW_NOTICES.INVALID)

  if (kind === 'today') {
    return {
      start: today,
      end: today,
      label: `Today, ${formatDayMonthYear(today)}`,
      chipKey: 'today',
      href: windowHref('', { kind: 'today' }),
      notice: null,
    }
  }

  if (kind === 'week') {
    const start = weekStartOf(today)
    const end = addDays(start, 6)
    return {
      start,
      end,
      label: `This week, ${rangeLabelShort(start, end)}`,
      chipKey: 'week',
      href: windowHref('', { kind: 'week' }),
      notice: null,
    }
  }

  if (kind === 'month') return monthResolution(today, null)

  if (kind === 'quarter') {
    const q = quarters.find(candidate => candidate.months.includes(todayMonth))
    const start = monthStartOf(q.months[0])
    const end = monthEndOf(q.months[q.months.length - 1])
    return {
      start,
      end,
      label: `This quarter, ${formatQuarter(q.fy, q.quarter)} (${formatQuarterMonths(q.months)})`,
      chipKey: 'quarter',
      href: windowHref('', { kind: 'quarter' }),
      notice: null,
    }
  }

  if (kind === 'fy') {
    const f = fys.find(candidate => candidate.months.includes(todayMonth))
    const start = monthStartOf(f.months[0])
    const end = monthEndOf(f.months[f.months.length - 1])
    return {
      start,
      end,
      label: `This FY, FY${fySuffix(f.fy)} (${monthsRangeLabel(f.months)})`,
      chipKey: 'fy',
      href: windowHref('', { kind: 'fy' }),
      notice: null,
    }
  }

  if (kind === 'm') {
    if (!allMonths.includes(parsed.month)) return monthResolution(today, WINDOW_NOTICES.INVALID)
    if (parsed.month > todayMonth) return monthResolution(today, WINDOW_NOTICES.NOT_STARTED)
    const start = parsed.month
    const end = monthEndOf(start)
    return {
      start,
      end,
      label: formatMonthYear(start),
      chipKey: `m-${start.slice(0, 7)}`,
      href: windowHref('', { kind: 'm', month: start }),
      notice: null,
    }
  }

  if (kind === 'q') {
    const q = quarters.find(candidate => candidate.fy === parsed.fy && candidate.quarter === parsed.quarter)
    if (q === undefined) return monthResolution(today, WINDOW_NOTICES.INVALID)
    if (q.months[0] > todayMonth) return monthResolution(today, WINDOW_NOTICES.NOT_STARTED)
    const start = monthStartOf(q.months[0])
    const end = monthEndOf(q.months[q.months.length - 1])
    return {
      start,
      end,
      label: `${formatQuarter(q.fy, q.quarter)} (${formatQuarterMonths(q.months)})`,
      chipKey: `q-${q.fy}-${q.quarter}`,
      href: windowHref('', { kind: 'q', fy: q.fy, quarter: q.quarter }),
      notice: null,
    }
  }

  if (kind === 'fyx') {
    const f = fys.find(candidate => candidate.fy === parsed.fy)
    if (f === undefined) return monthResolution(today, WINDOW_NOTICES.INVALID)
    if (f.months[0] > todayMonth) return monthResolution(today, WINDOW_NOTICES.NOT_STARTED)
    const start = monthStartOf(f.months[0])
    const end = monthEndOf(f.months[f.months.length - 1])
    return {
      start,
      end,
      label: `FY${fySuffix(f.fy)} (${monthsRangeLabel(f.months)})`,
      chipKey: null,
      href: windowHref('', { kind: 'fyx', fy: f.fy }),
      notice: null,
    }
  }

  // kind === 'range'
  const { from, to } = parsed
  if (from > to) return monthResolution(today, WINDOW_NOTICES.RANGE_ORDER)
  if (from < calendarStart || to > calendarEnd) {
    return monthResolution(today, WINDOW_NOTICES.RANGE_CALENDAR(calendarStart, calendarEnd))
  }
  if (from > today) return monthResolution(today, WINDOW_NOTICES.NOT_STARTED)
  if (daysBetween(from, to) + 1 > 366) return monthResolution(today, WINDOW_NOTICES.RANGE_LONG)
  return {
    start: from,
    end: to,
    label: rangeLabelLong(from, to),
    chipKey: null,
    href: windowHref('', { kind: 'range', from, to }),
    notice: null,
  }
}

const PERIODS = [
  ['today', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['quarter', 'This quarter'],
  ['fy', 'This FY'],
]

export function windowOptions(today, quarterMonthRows, basePath) {
  const todayMonth = monthStartOf(today)
  const fys = groupFys(quarterMonthRows)
  const quarters = groupQuarters(quarterMonthRows)
  const { calendarStart, calendarEnd } = calendarBounds(quarterMonthRows)
  const todayFy = fys.find(f => f.months.includes(todayMonth))

  const periods = PERIODS.map(([key, label]) => ({ key, label, href: windowHref(basePath, { kind: key }) }))

  const months = todayFy.months.map(month => {
    const started = month <= todayMonth
    return {
      key: `m-${month.slice(0, 7)}`,
      short: formatDayMonth(month).split(' ')[2],
      hiddenYear: ` ${month.slice(0, 4)}`,
      href: started ? windowHref(basePath, { kind: 'm', month }) : null,
    }
  })

  const fyQuarters = quarters.filter(q => q.fy === todayFy.fy)
  const quarterChips = fyQuarters.map(q => {
    const started = q.months[0] <= todayMonth
    return {
      key: `q-${q.fy}-${q.quarter}`,
      short: `Q${q.quarter}`,
      hidden: ` FY${fySuffix(q.fy)}`,
      href: started ? windowHref(basePath, { kind: 'q', fy: q.fy, quarter: q.quarter }) : null,
    }
  })

  return {
    fyLabel: `FY${fySuffix(todayFy.fy)}`,
    periods,
    months,
    quarters: quarterChips,
    calendarStart,
    calendarEnd,
  }
}
