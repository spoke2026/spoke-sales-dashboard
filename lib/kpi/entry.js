// Manual entry: the week grid and the save API's planning (PRD 10.4, 12.2, D3,
// D6, D7, D15). Pure: no UI, database or network. Never mutates its inputs.
// Request bodies are frozen (rule 6): a missing or extra key fails validation.
//
// No JS here works out the 7-day rule or who may enter for whom (rule 7).
// Those come from kpi_entry_cells and kpi_entry_people through the database;
// this module only shapes what the grid shows and what the API sends.

import { isUuid, parseTargetText, readStoredNumber, formatExampleTarget, toDisplayNumber } from './library.js'
import { targetUnchanged, SAVE_ERROR } from './scorecard.js'
import { isIsoDate, addDays, countTargetDays, monthStartOf } from './calendar.js'
import { formatDayMonth } from './format.js'
import { formatQuarter } from './scorecard.js'
import { planKpiWindow, judgeKpi, toEngineActuals } from './view.js'
import { weekStartOf } from './window.js'

export const ENTRY_FORBIDDEN = "You can't enter actuals for this person."
export const WINDOW_CLOSED = 'Days more than 7 days ago can only be changed by your line manager or the admin.'
export const FUTURE = "You can't enter actuals for a day that hasn't happened yet."
export const CLEAR = "Saved entries can't be cleared. Enter the right number instead."
export const BOTH = 'Enter both numbers, or leave both empty.'
export const BAD_NUMBER = 'Enter a number of 0 or more, without commas or symbols.'
export const NOTHING = 'Nothing has changed. Change an entry first.'
export const NOT_ON_SCORECARD = "One of these KPIs is no longer on the scorecard for that day. Refresh the page."
export const AUTOMATED_EXISTS = "This KPI already has an automated actual for that day, so it can't be entered by hand."
export const PERSON_NOT_ELIGIBLE =
  "This person isn't set up for an individual scorecard. Check they're active and set to Individual on People and teams."

const SAVE_KEYS = Object.freeze(['personId', 'weekStart', 'cells'])
const CELL_KEYS = Object.freeze(['kpiId', 'date', 'value', 'outOf'])
const GENERIC = Object.freeze({ ok: false, status: 400, error: SAVE_ERROR })

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function hasExactKeys(body, keys) {
  if (!isPlainObject(body)) return false
  const present = Object.keys(body)
  return present.length === keys.length && keys.every(k => present.includes(k))
}

export function entryField(kpiId, date) {
  return `entry:${kpiId}:${date}`
}

export function validateEntrySave(body) {
  if (!hasExactKeys(body, SAVE_KEYS)) return GENERIC
  if (!isUuid(body.personId)) return GENERIC
  if (!isIsoDate(body.weekStart) || weekStartOf(body.weekStart) !== body.weekStart) return GENERIC
  if (!Array.isArray(body.cells) || body.cells.length < 1 || body.cells.length > 56) return GENERIC

  const weekEnd = addDays(body.weekStart, 6)
  const seen = new Set()
  for (const cell of body.cells) {
    if (!hasExactKeys(cell, CELL_KEYS)) return GENERIC
    if (!isUuid(cell.kpiId)) return GENERIC
    if (!isIsoDate(cell.date) || cell.date < body.weekStart || cell.date > weekEnd) return GENERIC
    if (typeof cell.value !== 'string' || cell.value.length > 30) return GENERIC
    if (typeof cell.outOf !== 'string' || cell.outOf.length > 30) return GENERIC
    const key = `${cell.kpiId}:${cell.date}`
    if (seen.has(key)) return GENERIC
    seen.add(key)
  }

  return {
    ok: true,
    value: {
      personId: body.personId,
      weekStart: body.weekStart,
      cells: body.cells.map(c => ({ kpiId: c.kpiId, date: c.date, value: c.value, outOf: c.outOf })),
    },
  }
}

export function planEntryUpserts({ personId, cells, cellInfo, definitions, current, today }) {
  const rows = []

  for (const cell of cells) {
    const field = entryField(cell.kpiId, cell.date)
    const info = cellInfo.get(field)
    if (info === undefined) return { ok: false, status: 409, error: NOT_ON_SCORECARD }

    if (!info.canWrite) {
      if (cell.date > today) return { ok: false, status: 400, error: FUTURE, field }
      return { ok: false, status: 403, error: WINDOW_CLOSED }
    }

    const def = definitions.get(`${cell.kpiId}:${info.kpiVersion}`)
    const cur = current.get(field)

    if (def.aggregation === 'ratio') {
      const valueParsed = parseTargetText('count', cell.value)
      const outOfParsed = parseTargetText('count', cell.outOf)
      if (!valueParsed.ok || !outOfParsed.ok) return { ok: false, status: 400, error: BAD_NUMBER, field }

      const valueEmpty = valueParsed.value === null
      const outOfEmpty = outOfParsed.value === null

      if (valueEmpty && outOfEmpty) {
        if (cur !== undefined) return { ok: false, status: 400, error: CLEAR, field }
        continue
      }
      if (valueEmpty || outOfEmpty) return { ok: false, status: 400, error: BOTH, field }

      const unchanged =
        cur !== undefined &&
        targetUnchanged('count', cell.value, cur.numerator) &&
        targetUnchanged('count', cell.outOf, cur.denominator)
      if (unchanged) continue

      rows.push({
        person_id: personId,
        kpi_definition_id: cell.kpiId,
        date: cell.date,
        value: null,
        numerator: valueParsed.value,
        denominator: outOfParsed.value,
      })
      continue
    }

    if (cell.outOf !== '') return { ok: false, status: 400, error: SAVE_ERROR }
    const parsed = parseTargetText(def.unit, cell.value)
    if (!parsed.ok) return { ok: false, status: 400, error: BAD_NUMBER, field }

    if (parsed.value === null) {
      if (cur !== undefined) return { ok: false, status: 400, error: CLEAR, field }
      continue
    }
    if (cur !== undefined && targetUnchanged(def.unit, cell.value, cur.value)) continue

    rows.push({
      person_id: personId,
      kpi_definition_id: cell.kpiId,
      date: cell.date,
      value: parsed.value,
      numerator: null,
      denominator: null,
    })
  }

  if (rows.length === 0) return { ok: false, status: 400, error: NOTHING }
  return { ok: true, rows }
}

// Matches error.code with === only, never the message text (rule 14).
export function mapEntryDbError(error) {
  const code = isPlainObject(error) ? error.code : undefined
  if (code === '42501') return { status: 403, error: ENTRY_FORBIDDEN }
  if (code === 'KS007') return { status: 400, error: PERSON_NOT_ELIGIBLE }
  if (code === 'KS015') return { status: 400, error: FUTURE }
  if (code === 'KS016') return { status: 409, error: NOT_ON_SCORECARD }
  if (code === 'KS017') return { status: 403, error: WINDOW_CLOSED }
  if (code === 'KS019') return { status: 409, error: AUTOMATED_EXISTS }
  if (code === 'KS001') return { status: 403, error: ENTRY_FORBIDDEN }
  if (code === 'KS011' || code === '23514' || code === '23502') return { status: 400, error: SAVE_ERROR }
  if (code === '23503') return { status: 400, error: 'That person or KPI no longer exists. Refresh the page.' }
  return { status: 500, error: SAVE_ERROR }
}

function helperFor(aggregation, unit) {
  let text
  if (aggregation === 'sum') text = "Enter the day's total."
  else if (aggregation === 'latest') text = 'Enter the figure at the end of the day. The window uses the latest one.'
  else if (aggregation === 'average') {
    text = "Enter the day's figure. The window uses the average of the days entered."
  } else text = "Enter the result and what it's out of, for example 3 out of 5."
  if (unit === 'percent' && aggregation !== 'ratio') text += ' For a percent, enter 33 for 33%.'
  return text
}

function buildUnapprovedQuarterLabels(cells, quarterMonthRows) {
  const monthRowByMonth = new Map(quarterMonthRows.map(r => [r.month, r]))
  const seen = new Set()
  const labels = []
  for (const cell of cells) {
    if (cell.scorecard_status === 'locked') continue
    const month = monthStartOf(cell.date)
    const row = monthRowByMonth.get(month)
    if (row === undefined) continue
    const key = `${row.fy}-${row.quarter}`
    if (seen.has(key)) continue
    seen.add(key)
    labels.push(formatQuarter(row.fy, row.quarter))
  }
  return labels
}

// D15: a cell is flagged Missing only when the engine, judging that one day
// on its own, would colour it RED. Never "the cell is empty".
function isCellMissing({ definition, day, today, entry, calendar, targetsForKpi, actualsForKpiToday, quarterMonthRows }) {
  if (entry !== undefined) return false
  if (day > today) return false

  const targetDays = countTargetDays({ calendar, phasing: definition.phasing, start: day, end: day })
  if (targetDays !== 1) return false

  const plan = planKpiWindow({
    window: { start: day, end: day },
    today,
    targetRows: targetsForKpi,
    quarterMonthRows,
  })
  if (plan.kind !== 'judge') return false

  const judged = judgeKpi({
    plan,
    definition,
    today,
    calendar,
    actuals: toEngineActuals(actualsForKpiToday),
  })
  return judged.ok && judged.result.status === 'RED'
}

export function buildEntryGrid({ weekStart, today, cells, entries, definitions, targetRows, calendar, actuals, quarterMonthRows }) {
  const days = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    days.push({ date, label: formatDayMonth(date), isToday: date === today })
  }

  const defByKey = new Map(definitions.map(d => [`${d.id}:${d.version}`, d]))
  const cellsByKey = new Map(cells.map(c => [`${c.kpi_definition_id}:${c.date}`, c]))
  const entryByKey = new Map(entries.map(e => [`${e.kpi_definition_id}:${e.date}`, e]))

  const kpiVersion = new Map()
  for (const cell of cells) {
    if (!kpiVersion.has(cell.kpi_definition_id)) kpiVersion.set(cell.kpi_definition_id, cell.kpi_version)
  }

  const sortOrderByKpi = new Map()
  const targetsByKpi = new Map()
  for (const row of targetRows) {
    if (!sortOrderByKpi.has(row.kpi_definition_id)) sortOrderByKpi.set(row.kpi_definition_id, row.sort_order)
    let list = targetsByKpi.get(row.kpi_definition_id)
    if (list === undefined) {
      list = []
      targetsByKpi.set(row.kpi_definition_id, list)
    }
    list.push(row)
  }

  const actualsByKpi = new Map()
  for (const row of actuals) {
    let list = actualsByKpi.get(row.kpi_definition_id)
    if (list === undefined) {
      list = []
      actualsByKpi.set(row.kpi_definition_id, list)
    }
    list.push(row)
  }

  const kpiIds = [...kpiVersion.keys()].sort((a, b) => {
    const sa = sortOrderByKpi.has(a) ? sortOrderByKpi.get(a) : Number.MAX_SAFE_INTEGER
    const sb = sortOrderByKpi.has(b) ? sortOrderByKpi.get(b) : Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return a.localeCompare(b)
  })

  let missingCount = 0
  let anyClosed = false
  const editableDates = new Set()

  const rows = kpiIds.map(kpiId => {
    const version = kpiVersion.get(kpiId)
    const definition = defByKey.get(`${kpiId}:${version}`)
    const unit = definition.unit
    const aggregation = definition.aggregation

    const rowCells = days.map(day => {
      const key = `${kpiId}:${day.date}`
      const cell = cellsByKey.get(key)
      const field = entryField(kpiId, day.date)
      const entry = entryByKey.get(key)

      let state
      if (cell === undefined) state = 'not_scored'
      else if (day.date > today) state = 'future'
      else if (!cell.can_write) state = 'closed'
      else state = 'editable'

      if (state === 'editable') editableDates.add(day.date)
      if (state === 'closed') anyClosed = true

      let initialValue = ''
      let initialOutOf = ''
      if (entry !== undefined) {
        if (aggregation === 'ratio') {
          initialValue = entry.numerator === null ? '' : String(entry.numerator)
          initialOutOf = entry.denominator === null ? '' : String(entry.denominator)
        } else {
          initialValue = entry.value === null ? '' : String(toDisplayNumber(unit, readStoredNumber(entry.value)))
        }
      }

      let display = null
      if (state === 'closed') {
        if (entry === undefined) display = 'Not entered'
        else if (aggregation === 'ratio') display = `${entry.numerator} out of ${entry.denominator}`
        else display = formatExampleTarget(unit, readStoredNumber(entry.value))
      }

      const missing =
        cell !== undefined &&
        isCellMissing({
          definition,
          day: day.date,
          today,
          entry,
          calendar,
          targetsForKpi: targetsByKpi.get(kpiId) ?? [],
          actualsForKpiToday: (actualsByKpi.get(kpiId) ?? []).filter(a => a.date === day.date),
          quarterMonthRows,
        })
      if (missing) missingCount += 1

      return { date: day.date, state, field, initialValue, initialOutOf, display, missing }
    })

    return { kpiId, name: definition.name, unit, aggregation, helper: helperFor(aggregation, unit), cells: rowCells }
  })

  let closedBefore = null
  if (anyClosed) {
    const editable = [...editableDates].sort()
    if (editable.length > 0) closedBefore = formatDayMonth(editable[0])
  }

  return {
    days,
    rows,
    missingCount,
    closedBefore,
    unapprovedQuarterLabels: buildUnapprovedQuarterLabels(cells, quarterMonthRows),
  }
}
