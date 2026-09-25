// Turns database rows into the person scorecard's cards (PRD 12.2, D10, D14).
// Pure: no UI, database or network. Never mutates its inputs.
//
// The engine (status.js) is the only place a status is decided (rule 7). This
// module only decides WHICH months a KPI is judged over (D10's trim and gap
// rule) and applies D14's one narrow override for an unconnected source with
// no data at all. Neither of those compares an actual with a target itself.

import { evaluateKpi, STATUS, KpiEngineError } from './status.js'
import { monthStartOf, monthEndOf, addDays } from './calendar.js'
import { formatExampleTarget, readStoredNumber, labelFor } from './library.js'
import { formatLongDate } from './format.js'
import { formatQuarter } from './scorecard.js'

export { KpiEngineError }

// Phase 4 adds a source to this list; nothing else changes (D14).
export const CONNECTED_SOURCES = Object.freeze(['manual'])

const NUMBER_RE = /^-?\d+(\.\d+)?$/

const ERROR_COPY = "We couldn't work out this KPI's status. Tell the admin."
const NOT_CONNECTED_NOTE =
  'Not connected yet. This KPI has no data until its data source is connected, so it shows red.'
const MISSING_NOTE = 'No actuals entered for this window.'
const ZERO_TARGET_NOTE = 'The target for this window is 0, so it counts as on target.'
const NON_SUM_NOTE = 'Judged against the full monthly target, not a share of it.'

// null for a missing value, the number for a finite number, Number(raw) for a
// string matching a plain signed decimal, otherwise NaN (so the engine throws
// INVALID_ACTUAL rather than a bad value silently becoming 0, rule 8).
// Negative numbers are valid actuals (an automated KPI such as margin).
export function readActualNumber(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  if (typeof raw === 'string' && NUMBER_RE.test(raw)) return Number(raw)
  return NaN
}

export function toEngineActuals(rows) {
  return rows.map(row => ({
    date: row.date,
    value: readActualNumber(row.value),
    numerator: readActualNumber(row.numerator),
    denominator: readActualNumber(row.denominator),
  }))
}

// Pages a query until a page comes back short. fetchPage(from, to) builds the
// ordered, ranged query itself; this only drives the paging (D8, the 1,000
// row cap).
export async function fetchAllRows(fetchPage, { pageSize = 1000, maxPages = 20 } = {}) {
  const data = []
  let from = 0
  for (let page = 0; page < maxPages; page++) {
    const to = from + pageSize - 1
    const { data: rows, error } = await fetchPage(from, to)
    if (error) return { error }
    data.push(...rows)
    if (rows.length < pageSize) return { data }
    from += pageSize
  }
  return { error: new Error('Too many rows to load in one window. Narrow the range and try again.') }
}

function monthsBetween(start, end) {
  const out = []
  for (let m = monthStartOf(start); m <= end; m = addDays(monthEndOf(m), 1)) out.push(m)
  return out
}

function quarterLabelsForMonths(months, quarterMonthRows, rowsByMonth) {
  const byMonth = new Map(quarterMonthRows.map(r => [r.month, r]))
  const seen = new Set()
  const labels = []
  for (const m of months) {
    if (rowsByMonth.has(m)) continue
    const row = byMonth.get(m)
    if (row === undefined) continue
    const key = `${row.fy}-${row.quarter}`
    if (seen.has(key)) continue
    seen.add(key)
    labels.push(formatQuarter(row.fy, row.quarter))
  }
  return labels
}

// D10: for one KPI, which months of the window it has an approved (locked
// scorecard) target for, and what to do about the rest.
export function planKpiWindow({ window, today, targetRows, quarterMonthRows }) {
  const { start, end } = window
  const monthsInWindow = monthsBetween(start, end)

  const rowsByMonth = new Map()
  for (const row of targetRows) {
    if (monthsInWindow.includes(row.month)) rowsByMonth.set(row.month, row)
  }
  const approvedMonths = monthsInWindow.filter(m => rowsByMonth.has(m))
  if (approvedMonths.length === 0) return { kind: 'none' }

  const first = approvedMonths[0]
  const last = approvedMonths[approvedMonths.length - 1]
  const lastRow = rowsByMonth.get(last)
  const pinned = { kpiVersion: lastRow.kpi_version, sortOrder: lastRow.sort_order }

  const span = monthsBetween(first, last)
  const gapMonths = span.filter(m => !rowsByMonth.has(m))

  if (gapMonths.length > 0) {
    return { kind: 'gap', gapQuarterLabels: quarterLabelsForMonths(span, quarterMonthRows, rowsByMonth), pinned }
  }

  const trimmedStart = first > start ? first : start
  const lastMonthEnd = monthEndOf(last)
  const trimmedEnd = lastMonthEnd < end ? lastMonthEnd : end
  if (trimmedStart > today) return { kind: 'none' }

  return {
    kind: 'judge',
    start: trimmedStart,
    end: trimmedEnd,
    trimmed: trimmedStart !== start || trimmedEnd !== end,
    targets: approvedMonths.map(m => ({ month: m, value: readStoredNumber(rowsByMonth.get(m).value) })),
    pinned,
  }
}

export function judgeKpi({ plan, definition, today, calendar, actuals }) {
  try {
    const result = evaluateKpi({
      definition,
      window: { start: plan.start, end: plan.end },
      today,
      calendar,
      targets: plan.targets,
      actuals,
    })
    return { ok: true, result }
  } catch (error) {
    if (error instanceof KpiEngineError) return { ok: false, code: error.code }
    throw error
  }
}

export function formatVariance(unit, n) {
  if (n === 0) return formatExampleTarget(unit, 0)
  if (n > 0) return `+${formatExampleTarget(unit, n)}`
  return `−${formatExampleTarget(unit, Math.abs(n))}`
}

export function statusDisplay(status) {
  if (status === STATUS.GREEN) return { symbol: '✓', label: 'On target', tone: 'green' }
  return { symbol: '✗', label: 'Off target', tone: 'red' }
}

function joinLabels(list) {
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}

function trimmedNote(plan) {
  return `Judged from ${formatLongDate(plan.start)} to ${formatLongDate(plan.end)}, the months this KPI has an approved target.`
}

function gapNote(labels) {
  return `${joinLabels(labels)} has no approved target for this KPI, so it's red for this window.`
}

function groupBy(rows, key) {
  const map = new Map()
  for (const row of rows) {
    const k = row[key]
    let list = map.get(k)
    if (list === undefined) {
      list = []
      map.set(k, list)
    }
    list.push(row)
  }
  return map
}

// Every quarter the window touches that has started and has no locked
// scorecard for this person (D11).
function buildQuarterNote({ window, today, quarterMonthRows, scorecards, empty }) {
  const todayMonth = monthStartOf(today)
  const months = monthsBetween(window.start, window.end)
  const byKey = new Map()
  for (const row of quarterMonthRows) {
    const key = `${row.fy}-${row.quarter}`
    let entry = byKey.get(key)
    if (entry === undefined) {
      entry = { fy: row.fy, quarter: row.quarter, months: [] }
      byKey.set(key, entry)
    }
    entry.months.push(row.month)
  }
  const quarters = [...byKey.values()]
  for (const q of quarters) q.months.sort()

  const lockedKeys = new Set(scorecards.filter(s => s.status === 'locked').map(s => `${s.fy}-${s.quarter}`))

  const missing = []
  for (const q of quarters.sort((a, b) => a.fy - b.fy || a.quarter - b.quarter)) {
    const key = `${q.fy}-${q.quarter}`
    if (!q.months.some(m => months.includes(m))) continue
    if (q.months[0] > todayMonth) continue
    if (lockedKeys.has(key)) continue
    missing.push(formatQuarter(q.fy, q.quarter))
  }

  if (missing.length === 0) return null
  const verb = missing.length === 1 ? 'has' : 'have'
  const joined = joinLabels(missing)
  if (empty) return `${joined} ${verb} no approved scorecard, so there's nothing to judge for this window.`
  return `${joined} ${verb} no approved scorecard, so this window only judges the months that do.`
}

export function buildPersonScorecard({ window, today, calendar, targetRows, definitions, actuals, quarterMonthRows, scorecards }) {
  const targetsByKpi = groupBy(targetRows, 'kpi_definition_id')
  const actualsByKpi = groupBy(actuals, 'kpi_definition_id')

  const built = []
  for (const [kpiId, rows] of targetsByKpi) {
    const plan = planKpiWindow({ window, today, targetRows: rows, quarterMonthRows })
    if (plan.kind === 'none') continue

    const definition = definitions.find(d => d.id === kpiId && d.version === plan.pinned.kpiVersion)
    // A target row whose pinned definition didn't load is a broken read, not
    // a KPI to colour (rule 8). The page shows its error state.
    if (definition === undefined) {
      throw new KpiEngineError('MISSING_DEFINITION', `KPI ${kpiId} version ${plan.pinned.kpiVersion} did not load.`)
    }
    const meta = `${labelFor('kpiType', definition.kpi_type)}, ${labelFor('unit', definition.unit)}, ${labelFor('source', definition.source)}`

    if (plan.kind === 'gap') {
      const display = statusDisplay(STATUS.RED)
      built.push({
        sortOrder: plan.pinned.sortOrder,
        card: {
          kpiId,
          name: definition.name,
          version: definition.version,
          meta,
          status: STATUS.RED,
          statusLabel: display.label,
          symbol: display.symbol,
          figures: null,
          notes: [gapNote(plan.gapQuarterLabels)],
          error: null,
        },
      })
      continue
    }

    const kpiActuals = toEngineActuals(actualsByKpi.get(kpiId) ?? [])
    const judged = judgeKpi({ plan, definition, today, calendar, actuals: kpiActuals })

    if (!judged.ok) {
      built.push({
        sortOrder: plan.pinned.sortOrder,
        card: {
          kpiId,
          name: definition.name,
          version: definition.version,
          meta,
          status: null,
          statusLabel: null,
          symbol: null,
          figures: null,
          notes: [],
          error: ERROR_COPY,
        },
      })
      continue
    }

    const result = judged.result
    const overridden = !CONNECTED_SOURCES.includes(definition.source) && result.missing === true
    const status = overridden ? STATUS.RED : result.status
    const display = statusDisplay(status)

    const notes = []
    if (plan.trimmed) notes.push(trimmedNote(plan))
    if (overridden) {
      notes.push(NOT_CONNECTED_NOTE)
    } else {
      if (result.missing && CONNECTED_SOURCES.includes(definition.source)) notes.push(MISSING_NOTE)
      if (result.reason === 'ZERO_TARGET') notes.push(ZERO_TARGET_NOTE)
    }
    if (definition.aggregation !== 'sum') notes.push(NON_SUM_NOTE)

    built.push({
      sortOrder: plan.pinned.sortOrder,
      card: {
        kpiId,
        name: definition.name,
        version: definition.version,
        meta,
        status,
        statusLabel: display.label,
        symbol: display.symbol,
        figures: {
          actual: result.actual === null ? 'No data' : formatExampleTarget(definition.unit, result.actual),
          targetToDate: formatExampleTarget(definition.unit, result.targetToDate),
          fullTarget: formatExampleTarget(definition.unit, result.fullTarget),
          variance:
            result.actual === null ? 'No data' : formatVariance(definition.unit, result.actual - result.targetToDate),
        },
        notes,
        error: null,
      },
    })
  }

  built.sort((a, b) => a.sortOrder - b.sortOrder || a.card.name.localeCompare(b.card.name))
  const cards = built.map(b => b.card)
  const empty = cards.length === 0
  const quarterNote = buildQuarterNote({ window, today, quarterMonthRows, scorecards, empty })

  return { cards, quarterNote, empty }
}
