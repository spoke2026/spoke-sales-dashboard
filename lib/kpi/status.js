// The KPI red/green status engine (PRD §8). Pure: no UI, database or network.
//
// A KPI is GREEN if its actual for the window meets or beats its target to
// date, otherwise RED. Missing actual is RED. Configuration errors throw a
// KpiEngineError instead of being coloured. Only sum KPIs are prorated.
// Values are compared unrounded; rounding is display-only.

import {
  KpiEngineError,
  isIsoDate,
  addDays,
  monthStartOf,
  monthEndOf,
  countTargetDays,
} from './calendar.js'

export { KpiEngineError }

export const STATUS = Object.freeze({ GREEN: 'GREEN', RED: 'RED' })

const DIRECTIONS = ['higher', 'lower']
const AGGREGATIONS = ['sum', 'average', 'ratio', 'latest']
const PHASINGS = ['working_days', 'calendar_days']

const earlier = (a, b) => (a < b ? a : b)
const later = (a, b) => (a > b ? a : b)

function targetFor(targets, month) {
  if (!Array.isArray(targets)) {
    throw new KpiEngineError('INVALID_INPUT', 'Targets must be an array of rows.')
  }
  const rows = targets.filter(t => t.month === month)
  if (rows.length === 0) {
    throw new KpiEngineError('MISSING_TARGET', `There is no target for ${month}.`)
  }
  if (rows.length > 1) {
    throw new KpiEngineError('INVALID_TARGET', `There is more than one target for ${month}.`)
  }
  const value = rows[0].value
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new KpiEngineError('INVALID_TARGET', `The target for ${month} is not a number of 0 or more.`)
  }
  return value
}

// Multiply then divide, per month. Never add up per-day fractions: a full
// month contributes its target exactly, so "exactly on target" stays exact.
function share(value, counted, monthDays) {
  if (monthDays === 0) return 0
  if (counted === monthDays) return value
  return (value * counted) / monthDays
}

export function windowTargets({ phasing, calendar, targets, start, end, today }) {
  let targetToDate = 0
  let fullTarget = 0
  for (let month = monthStartOf(start); month <= end; month = addDays(monthEndOf(month), 1)) {
    const value = targetFor(targets, month)
    const monthEnd = monthEndOf(month)
    const from = later(start, month)
    const to = earlier(end, monthEnd)
    const monthDays = countTargetDays({ calendar, phasing, start: month, end: monthEnd })
    const inWindow = countTargetDays({ calendar, phasing, start: from, end: to })
    const toDate = countTargetDays({ calendar, phasing, start: from, end: earlier(to, today) })
    fullTarget += share(value, inWindow, monthDays)
    targetToDate += share(value, toDate, monthDays)
  }
  return { targetToDate, fullTarget }
}

function checkNumber(v) {
  if (v === null) return
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new KpiEngineError('INVALID_ACTUAL', 'An actual value is not a finite number.')
  }
}

function elapsedRows(actuals, start, elapsedEnd) {
  const rows = []
  for (const row of actuals) {
    if (row === null || typeof row !== 'object' || !isIsoDate(row.date)) {
      throw new KpiEngineError('INVALID_ACTUAL', 'An actual row has no valid date.')
    }
    if (row.date < start || row.date > elapsedEnd) continue
    checkNumber(row.value)
    checkNumber(row.numerator)
    checkNumber(row.denominator)
    rows.push(row)
  }
  return rows
}

function sumActual(rows) {
  const valued = rows.filter(r => r.value !== null)
  return { actual: valued.reduce((s, r) => s + r.value, 0), missing: valued.length === 0 }
}

function ratioActual(rows) {
  let numerator = 0
  let denominator = 0
  for (const r of rows) {
    if (r.numerator === null && r.denominator === null) continue
    if (r.numerator === null || r.denominator === null) {
      throw new KpiEngineError('INVALID_ACTUAL', `The actual for ${r.date} has only one of numerator and denominator.`)
    }
    if (r.denominator < 0) {
      throw new KpiEngineError('INVALID_ACTUAL', `The actual for ${r.date} has a negative denominator.`)
    }
    numerator += r.numerator
    denominator += r.denominator
  }
  if (denominator === 0) return { actual: null, missing: true }
  return { actual: numerator / denominator, missing: false }
}

function latestActual(rows) {
  let last = null
  for (const r of rows) {
    if (r.value !== null && (last === null || r.date > last.date)) last = r
  }
  if (last === null) return { actual: null, missing: true }
  return { actual: last.value, missing: false }
}

export function evaluateKpi({ definition, window, today, calendar, targets, actuals }) {
  const { direction, aggregation, phasing } = definition
  const { start, end } = window
  if (!DIRECTIONS.includes(direction)) throw new KpiEngineError('INVALID_INPUT', `Unknown direction ${direction}.`)
  if (!AGGREGATIONS.includes(aggregation)) throw new KpiEngineError('INVALID_INPUT', `Unknown aggregation ${aggregation}.`)
  if (!PHASINGS.includes(phasing)) throw new KpiEngineError('INVALID_INPUT', `Unknown phasing ${phasing}.`)
  if (!isIsoDate(start) || !isIsoDate(end) || !isIsoDate(today)) {
    throw new KpiEngineError('INVALID_INPUT', 'Window start, window end and today must be YYYY-MM-DD dates.')
  }
  if (start > end) throw new KpiEngineError('INVALID_INPUT', 'The window starts after it ends.')
  if (!Array.isArray(actuals)) throw new KpiEngineError('INVALID_INPUT', 'Actuals must be an array of rows.')

  let windowState = 'IN_PROGRESS'
  if (today < start) windowState = 'NOT_STARTED'
  if (today > end) windowState = 'CLOSED'

  // Today counts as a whole day. Empty when the window hasn't started.
  const elapsedEnd = earlier(end, today)
  const rows = elapsedRows(actuals, start, elapsedEnd)

  let target
  let result
  if (aggregation === 'sum') {
    target = windowTargets({ phasing, calendar, targets, start, end, today: elapsedEnd })
    result = sumActual(rows)
  } else {
    // Rate and level KPIs: the full monthly target of the evaluation month,
    // where evaluation date = max(start, min(end, today)). Not prorated.
    const value = targetFor(targets, monthStartOf(later(start, elapsedEnd)))
    target = { targetToDate: value, fullTarget: value }
    result = aggregation === 'latest' ? latestActual(rows) : ratioActual(rows)
  }
  const { targetToDate, fullTarget } = target
  const { actual, missing } = result

  let status
  let reason
  if (direction === 'higher' && targetToDate === 0) {
    status = STATUS.GREEN
    reason = 'ZERO_TARGET'
  } else if (actual === null) {
    status = STATUS.RED
    reason = 'MISSING'
  } else {
    const met = direction === 'higher' ? actual >= targetToDate : actual <= targetToDate
    status = met ? STATUS.GREEN : STATUS.RED
    reason = met ? 'MET' : 'NOT_MET'
  }

  return { status, actual, targetToDate, fullTarget, missing, reason, windowState }
}
