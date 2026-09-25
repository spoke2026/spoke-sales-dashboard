import { describe, it, expect } from 'vitest'
import {
  ENTRY_FORBIDDEN,
  WINDOW_CLOSED,
  FUTURE,
  CLEAR,
  BOTH,
  BAD_NUMBER,
  NOTHING,
  NOT_ON_SCORECARD,
  AUTOMATED_EXISTS,
  PERSON_NOT_ELIGIBLE,
  entryField,
  validateEntrySave,
  planEntryUpserts,
  mapEntryDbError,
  buildEntryGrid,
} from './entry.js'
import { SAVE_ERROR } from './scorecard.js'
import { buildCalendar } from './__fixtures__/calendar.js'

const PERSON = '11111111-1111-1111-1111-111111111111'
const KPI_SUM = '22222222-2222-2222-2222-222222222222'
const KPI_RATIO = '33333333-3333-3333-3333-333333333333'

function buildQuarterMonthRows(fys) {
  const rows = []
  for (const fy of fys) {
    const monthsOfFy = [
      [fy - 1, 4], [fy - 1, 5], [fy - 1, 6],
      [fy - 1, 7], [fy - 1, 8], [fy - 1, 9],
      [fy - 1, 10], [fy - 1, 11], [fy - 1, 12],
      [fy, 1], [fy, 2], [fy, 3],
    ]
    monthsOfFy.forEach(([y, m], i) => {
      const quarter = Math.floor(i / 3) + 1
      rows.push({ fy, quarter, month: `${y}-${String(m).padStart(2, '0')}-01` })
    })
  }
  return rows
}

const FY27_ROWS = buildQuarterMonthRows([2027])

describe('entryField', () => {
  it('joins kpiId and date', () => {
    expect(entryField(KPI_SUM, '2026-09-24')).toBe(`entry:${KPI_SUM}:2026-09-24`)
  })
})

describe('validateEntrySave', () => {
  const validBody = () => ({
    personId: PERSON,
    weekStart: '2026-09-21',
    cells: [{ kpiId: KPI_SUM, date: '2026-09-24', value: '5', outOf: '' }],
  })

  it('accepts a well-formed body', () => {
    const result = validateEntrySave(validBody())
    expect(result.ok).toBe(true)
    expect(result.value.cells).toHaveLength(1)
  })

  it('every top-level key removed in turn, and one extra key → generic 400 [frozen body]', () => {
    for (const key of ['personId', 'weekStart', 'cells']) {
      const body = validBody()
      delete body[key]
      expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    }
    expect(validateEntrySave({ ...validBody(), extra: 1 })).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('every cell key removed in turn, and one extra key → generic 400', () => {
    for (const key of ['kpiId', 'date', 'value', 'outOf']) {
      const body = validBody()
      const cell = { ...body.cells[0] }
      delete cell[key]
      body.cells = [cell]
      expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    }
    const body = validBody()
    body.cells = [{ ...body.cells[0], extra: 1 }]
    expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('a non-object body (null, an array, or a string) → generic', () => {
    expect(validateEntrySave(null)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    expect(validateEntrySave(['nope'])).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    expect(validateEntrySave('nope')).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('a cell that is not a plain object → generic', () => {
    const body = validBody()
    body.cells = [null]
    expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('a non-uuid personId → generic', () => {
    expect(validateEntrySave({ ...validBody(), personId: 'not-a-uuid' })).toEqual({
      ok: false, status: 400, error: SAVE_ERROR,
    })
  })

  it('weekStart a Tuesday → generic', () => {
    expect(validateEntrySave({ ...validBody(), weekStart: '2026-09-22' })).toEqual({
      ok: false, status: 400, error: SAVE_ERROR,
    })
  })

  it('a not-iso weekStart → generic', () => {
    expect(validateEntrySave({ ...validBody(), weekStart: 'banana' })).toEqual({
      ok: false, status: 400, error: SAVE_ERROR,
    })
  })

  it('cells not an array, empty, or over 56 → generic', () => {
    expect(validateEntrySave({ ...validBody(), cells: 'nope' })).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    expect(validateEntrySave({ ...validBody(), cells: [] })).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    const tooMany = Array.from({ length: 57 }, (_, i) => ({
      kpiId: KPI_SUM, date: '2026-09-21', value: String(i), outOf: '',
    }))
    expect(validateEntrySave({ ...validBody(), cells: tooMany })).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('a cell date outside the week → generic', () => {
    const body = validBody()
    body.cells = [{ ...body.cells[0], date: '2026-09-28' }]
    expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
    const before = validBody()
    before.cells = [{ ...before.cells[0], date: '2026-09-20' }]
    expect(validateEntrySave(before)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('a non-uuid kpiId, or an over-long value or outOf → generic', () => {
    const body = validBody()
    body.cells = [{ ...body.cells[0], kpiId: 'nope' }]
    expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })

    const long = validBody()
    long.cells = [{ ...long.cells[0], value: '1'.repeat(31) }]
    expect(validateEntrySave(long)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })

    const longOutOf = validBody()
    longOutOf.cells = [{ ...longOutOf.cells[0], outOf: '1'.repeat(31) }]
    expect(validateEntrySave(longOutOf)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })

    const badType = validBody()
    badType.cells = [{ ...badType.cells[0], value: 5 }]
    expect(validateEntrySave(badType)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })

    const badOutOfType = validBody()
    badOutOfType.cells = [{ ...badOutOfType.cells[0], outOf: 5 }]
    expect(validateEntrySave(badOutOfType)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it('a duplicate cell (same kpiId and date) → generic', () => {
    const body = validBody()
    body.cells = [body.cells[0], { ...body.cells[0] }]
    expect(validateEntrySave(body)).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })
})

describe('planEntryUpserts', () => {
  const TODAY = '2026-09-24'

  function cell(kpiId, date, value, outOf = '') {
    return { kpiId, date, value, outOf }
  }

  function cellInfoMap(entries) {
    return new Map(entries)
  }

  it("'0' with no current value → a row with value 0 [truthiness]", () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '0')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(result).toEqual({ ok: true, rows: [{ person_id: PERSON, kpi_definition_id: KPI_SUM, date: TODAY, value: 0, numerator: null, denominator: null }] })
  })

  it("'20.50' against stored 20.5, and '33.0' against stored 0.33 for percent, are unchanged", () => {
    const hours = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '20.50')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'hours', aggregation: 'sum' }]]),
      current: new Map([[entryField(KPI_SUM, TODAY), { value: 20.5, numerator: null, denominator: null }]]),
      today: TODAY,
    })
    expect(hours).toEqual({ ok: false, status: 400, error: NOTHING })

    const percent = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '33.0')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'percent', aggregation: 'average' }]]),
      current: new Map([[entryField(KPI_SUM, TODAY), { value: 0.33, numerator: 0.33, denominator: 1 }]]),
      today: TODAY,
    })
    expect(percent).toEqual({ ok: false, status: 400, error: NOTHING })
  })

  it('empty with current value 0 → CLEAR [0 treated as no value]', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map([[entryField(KPI_SUM, TODAY), { value: 0, numerator: null, denominator: null }]]),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: CLEAR, field: entryField(KPI_SUM, TODAY) })
  })

  it('empty with no current value is skipped, producing a 400 NOTHING when it is the only cell', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: NOTHING })
  })

  it('a non-numeric or negative value → field BAD_NUMBER', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '-1')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: BAD_NUMBER, field: entryField(KPI_SUM, TODAY) })
  })

  it('a non-ratio cell that also sends outOf → generic 400', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '5', '2')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: SAVE_ERROR })
  })

  it("ratio '3' and '' → BOTH; '' and '' with no current → skipped; '0' and '0' → numerator 0, denominator 0", () => {
    const info = cellInfoMap([[entryField(KPI_RATIO, TODAY), { canWrite: true, kpiVersion: 1 }]])
    const defs = new Map([[`${KPI_RATIO}:1`, { unit: 'percent', aggregation: 'ratio' }]])

    const both = planEntryUpserts({
      personId: PERSON, cells: [cell(KPI_RATIO, TODAY, '3', '')], cellInfo: info, definitions: defs,
      current: new Map(), today: TODAY,
    })
    expect(both).toEqual({ ok: false, status: 400, error: BOTH, field: entryField(KPI_RATIO, TODAY) })

    const skipped = planEntryUpserts({
      personId: PERSON, cells: [cell(KPI_RATIO, TODAY, '', '')], cellInfo: info, definitions: defs,
      current: new Map(), today: TODAY,
    })
    expect(skipped).toEqual({ ok: false, status: 400, error: NOTHING })

    const zeroes = planEntryUpserts({
      personId: PERSON, cells: [cell(KPI_RATIO, TODAY, '0', '0')], cellInfo: info, definitions: defs,
      current: new Map(), today: TODAY,
    })
    expect(zeroes).toEqual({
      ok: true,
      rows: [{ person_id: PERSON, kpi_definition_id: KPI_RATIO, date: TODAY, value: null, numerator: 0, denominator: 0 }],
    })
  })

  it('ratio: both numbers unchanged → skipped (NOTHING when it is the only cell)', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_RATIO, TODAY, '3', '5')],
      cellInfo: cellInfoMap([[entryField(KPI_RATIO, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_RATIO}:1`, { unit: 'percent', aggregation: 'ratio' }]]),
      current: new Map([[entryField(KPI_RATIO, TODAY), { value: null, numerator: 3, denominator: 5 }]]),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: NOTHING })
  })

  it('ratio: numerator text unchanged but denominator changed still produces a row', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_RATIO, TODAY, '3', '6')],
      cellInfo: cellInfoMap([[entryField(KPI_RATIO, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_RATIO}:1`, { unit: 'percent', aggregation: 'ratio' }]]),
      current: new Map([[entryField(KPI_RATIO, TODAY), { value: null, numerator: 3, denominator: 5 }]]),
      today: TODAY,
    })
    expect(result).toEqual({
      ok: true,
      rows: [{ person_id: PERSON, kpi_definition_id: KPI_RATIO, date: TODAY, value: null, numerator: 3, denominator: 6 }],
    })
  })

  it('ratio with a non-numeric side → field BAD_NUMBER', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_RATIO, TODAY, 'x', '5')],
      cellInfo: cellInfoMap([[entryField(KPI_RATIO, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_RATIO}:1`, { unit: 'percent', aggregation: 'ratio' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: BAD_NUMBER, field: entryField(KPI_RATIO, TODAY) })
  })

  it('ratio clearing an existing entry → CLEAR', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_RATIO, TODAY, '', '')],
      cellInfo: cellInfoMap([[entryField(KPI_RATIO, TODAY), { canWrite: true, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_RATIO}:1`, { unit: 'percent', aggregation: 'ratio' }]]),
      current: new Map([[entryField(KPI_RATIO, TODAY), { value: null, numerator: 3, denominator: 5 }]]),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: CLEAR, field: entryField(KPI_RATIO, TODAY) })
  })

  it('canWrite false: date ≤ today → 403 WINDOW_CLOSED; date > today → 400 FUTURE with the field', () => {
    const past = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, '2026-09-01', '5')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, '2026-09-01'), { canWrite: false, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(past).toEqual({ ok: false, status: 403, error: WINDOW_CLOSED })

    const future = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, '2026-10-01', '5')],
      cellInfo: cellInfoMap([[entryField(KPI_SUM, '2026-10-01'), { canWrite: false, kpiVersion: 1 }]]),
      definitions: new Map([[`${KPI_SUM}:1`, { unit: 'count', aggregation: 'sum' }]]),
      current: new Map(),
      today: TODAY,
    })
    expect(future).toEqual({ ok: false, status: 400, error: FUTURE, field: entryField(KPI_SUM, '2026-10-01') })
  })

  it('a cell absent from cellInfo → 409 NOT_ON_SCORECARD', () => {
    const result = planEntryUpserts({
      personId: PERSON,
      cells: [cell(KPI_SUM, TODAY, '5')],
      cellInfo: new Map(),
      definitions: new Map(),
      current: new Map(),
      today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 409, error: NOT_ON_SCORECARD })
  })

  it('no rows at all → 400 NOTHING', () => {
    const result = planEntryUpserts({
      personId: PERSON, cells: [], cellInfo: new Map(), definitions: new Map(), current: new Map(), today: TODAY,
    })
    expect(result).toEqual({ ok: false, status: 400, error: NOTHING })
  })
})

describe('mapEntryDbError', () => {
  it("mapEntryDbError({ code: 'KS017', message: 'KS015' }) gives WINDOW_CLOSED [message matching]", () => {
    expect(mapEntryDbError({ code: 'KS017', message: 'KS015' })).toEqual({ status: 403, error: WINDOW_CLOSED })
  })

  it('every mapped code', () => {
    expect(mapEntryDbError({ code: '42501' })).toEqual({ status: 403, error: ENTRY_FORBIDDEN })
    expect(mapEntryDbError({ code: 'KS007' })).toEqual({ status: 400, error: PERSON_NOT_ELIGIBLE })
    expect(mapEntryDbError({ code: 'KS015' })).toEqual({ status: 400, error: FUTURE })
    expect(mapEntryDbError({ code: 'KS016' })).toEqual({ status: 409, error: NOT_ON_SCORECARD })
    expect(mapEntryDbError({ code: 'KS019' })).toEqual({ status: 409, error: AUTOMATED_EXISTS })
    expect(mapEntryDbError({ code: 'KS001' })).toEqual({ status: 403, error: ENTRY_FORBIDDEN })
    expect(mapEntryDbError({ code: 'KS011' })).toEqual({ status: 400, error: SAVE_ERROR })
    expect(mapEntryDbError({ code: '23514' })).toEqual({ status: 400, error: SAVE_ERROR })
    expect(mapEntryDbError({ code: '23502' })).toEqual({ status: 400, error: SAVE_ERROR })
    expect(mapEntryDbError({ code: '23503' })).toEqual({
      status: 400, error: 'That person or KPI no longer exists. Refresh the page.',
    })
    expect(mapEntryDbError({ code: 'unknown' })).toEqual({ status: 500, error: SAVE_ERROR })
    expect(mapEntryDbError(null)).toEqual({ status: 500, error: SAVE_ERROR })
    expect(mapEntryDbError('nope')).toEqual({ status: 500, error: SAVE_ERROR })
  })
})

describe('buildEntryGrid', () => {
  const TODAY = '2026-09-24' // Thursday
  const WEEK_START = '2026-09-21' // Monday
  const CALENDAR = buildCalendar('2026-09-01', '2026-09-30')

  function baseCell(kpiId, date, overrides = {}) {
    return {
      date,
      is_working_day: true,
      kpi_definition_id: kpiId,
      kpi_version: 1,
      scorecard_id: 'sc-1',
      scorecard_status: 'locked',
      can_write: true,
      ...overrides,
    }
  }

  const daysOfWeek = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']

  function allCells(kpiId, overrides = {}) {
    return daysOfWeek.map(date => baseCell(kpiId, date, overrides))
  }

  const defSum = { id: KPI_SUM, version: 1, name: 'Visits', unit: 'count', direction: 'higher', aggregation: 'sum', phasing: 'working_days', source: 'manual' }
  const defRatio = { id: KPI_RATIO, version: 1, name: 'Rate', unit: 'percent', direction: 'higher', aggregation: 'ratio', phasing: 'working_days', source: 'manual' }

  const targetRowsSum = ['2026-09-01'].map(month => ({
    fy: 2027, quarter: 2, kpi_definition_id: KPI_SUM, kpi_version: 1, sort_order: 1, month, value: 20,
  }))

  it('a working day with no entry on a sum/higher KPI with target 20 is flagged [fails if "empty cell" is used instead of the engine]', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.missing).toBe(true)
    expect(grid.missingCount).toBeGreaterThan(0)
  })

  it('a Saturday with no entry is not flagged', () => {
    // A week already in the past, so the Saturday itself is not a future day
    // (isCellMissing must reach the target-day check, not stop at "future").
    const pastWeekStart = '2026-09-14'
    const pastToday = '2026-09-20' // the Sunday of that week
    const pastDays = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']
    const grid = buildEntryGrid({
      weekStart: pastWeekStart,
      today: pastToday,
      cells: pastDays.map(date => baseCell(KPI_SUM, date)),
      entries: [],
      definitions: [defSum],
      targetRows: [{ fy: 2027, quarter: 2, kpi_definition_id: KPI_SUM, kpi_version: 1, sort_order: 1, month: '2026-09-01', value: 20 }],
      calendar: buildCalendar('2026-09-01', '2026-09-30'),
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const sat = grid.rows[0].cells.find(c => c.date === '2026-09-19')
    expect(sat.missing).toBe(false)
    const fri = grid.rows[0].cells.find(c => c.date === '2026-09-18')
    expect(fri.missing).toBe(true)
  })

  it('a lower-is-better sum with no entry is not flagged', () => {
    const lowerDef = { ...defSum, direction: 'lower' }
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [lowerDef],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.missing).toBe(false)
  })

  it('a day with an entry of 0 is not flagged', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [{ kpi_definition_id: KPI_SUM, date: '2026-09-21', value: 0, numerator: null, denominator: null }],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [{ kpi_definition_id: KPI_SUM, date: '2026-09-21', value: 0, numerator: null, denominator: null }],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.missing).toBe(false)
    expect(mon.state).toBe('editable')
    expect(mon.initialValue).toBe('0')
  })

  it('a future day is not flagged, and has state future with no input', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const fri = grid.rows[0].cells.find(c => c.date === '2026-09-25')
    expect(fri.missing).toBe(false)
    expect(fri.state).toBe('future')
  })

  it('a day in a quarter with no locked scorecard is not flagged', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [defSum],
      targetRows: [], // no approved target anywhere
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.missing).toBe(false)
  })

  it('a KPI absent from cells for a day is not_scored, with no input', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM).filter(c => c.date !== '2026-09-22'),
      entries: [],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const tue = grid.rows[0].cells.find(c => c.date === '2026-09-22')
    expect(tue.state).toBe('not_scored')
    expect(tue.missing).toBe(false)
  })

  it('a closed day shows the saved display, and Not entered when there is none', () => {
    const cells = daysOfWeek.map(date =>
      baseCell(KPI_SUM, date, { can_write: date <= '2026-09-22' ? false : true })
    )
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells,
      entries: [{ kpi_definition_id: KPI_SUM, date: '2026-09-21', value: 5, numerator: null, denominator: null }],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [{ kpi_definition_id: KPI_SUM, date: '2026-09-21', value: 5, numerator: null, denominator: null }],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.state).toBe('closed')
    expect(mon.display).toBe('5')
    const tue = grid.rows[0].cells.find(c => c.date === '2026-09-22')
    expect(tue.display).toBe('Not entered')
    const wed = grid.rows[0].cells.find(c => c.date === '2026-09-23')
    expect(wed.state).toBe('editable')
    expect(grid.closedBefore).toBe('Wed 23 Sep')
  })

  it('a closed ratio day shows "n out of n"', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_RATIO, { can_write: false }),
      entries: [{ kpi_definition_id: KPI_RATIO, date: '2026-09-21', value: null, numerator: 3, denominator: 5 }],
      definitions: [defRatio],
      targetRows: [{ fy: 2027, quarter: 2, kpi_definition_id: KPI_RATIO, kpi_version: 1, sort_order: 1, month: '2026-09-01', value: 0.5 }],
      calendar: CALENDAR,
      actuals: [{ kpi_definition_id: KPI_RATIO, date: '2026-09-21', value: null, numerator: 3, denominator: 5 }],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.display).toBe('3 out of 5')
    expect(mon.initialValue).toBe('3')
    expect(mon.initialOutOf).toBe('5')
  })

  it('an editable cell whose stored entry has a null value or numerator/denominator shows an empty initial value', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [...allCells(KPI_SUM), ...allCells(KPI_RATIO)],
      entries: [
        { kpi_definition_id: KPI_SUM, date: '2026-09-21', value: null, numerator: null, denominator: null },
        { kpi_definition_id: KPI_RATIO, date: '2026-09-21', value: null, numerator: null, denominator: null },
      ],
      definitions: [defSum, defRatio],
      targetRows: [
        ...targetRowsSum,
        { fy: 2027, quarter: 2, kpi_definition_id: KPI_RATIO, kpi_version: 1, sort_order: 5, month: '2026-09-01', value: 0.5 },
      ],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const sumMon = grid.rows.find(r => r.kpiId === KPI_SUM).cells.find(c => c.date === '2026-09-21')
    expect(sumMon.initialValue).toBe('')
    const ratioMon = grid.rows.find(r => r.kpiId === KPI_RATIO).cells.find(c => c.date === '2026-09-21')
    expect(ratioMon.initialValue).toBe('')
    expect(ratioMon.initialOutOf).toBe('')
  })

  it('an editable ratio cell with no entry has empty initial values', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_RATIO),
      entries: [],
      definitions: [defRatio],
      targetRows: [{ fy: 2027, quarter: 2, kpi_definition_id: KPI_RATIO, kpi_version: 1, sort_order: 1, month: '2026-09-01', value: 0.5 }],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const mon = grid.rows[0].cells.find(c => c.date === '2026-09-21')
    expect(mon.initialValue).toBe('')
    expect(mon.initialOutOf).toBe('')
  })

  it('helper text for every aggregation, and the percent addendum for non-ratio percent KPIs', () => {
    const sumDef = defSum
    const latestDef = { ...defSum, id: 'k-latest', aggregation: 'latest' }
    const avgDef = { ...defSum, id: 'k-avg', aggregation: 'average' }
    const percentDef = { ...defSum, id: 'k-percent', aggregation: 'average', unit: 'percent' }
    const cellsFor = kpiId => allCells(kpiId)

    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [...cellsFor(KPI_SUM), ...cellsFor('k-latest'), ...cellsFor('k-avg'), ...cellsFor('k-percent'), ...allCells(KPI_RATIO)],
      entries: [],
      definitions: [sumDef, latestDef, avgDef, percentDef, defRatio],
      targetRows: [
        ...targetRowsSum,
        { fy: 2027, quarter: 2, kpi_definition_id: 'k-latest', kpi_version: 1, sort_order: 2, month: '2026-09-01', value: 20 },
        { fy: 2027, quarter: 2, kpi_definition_id: 'k-avg', kpi_version: 1, sort_order: 3, month: '2026-09-01', value: 20 },
        { fy: 2027, quarter: 2, kpi_definition_id: 'k-percent', kpi_version: 1, sort_order: 4, month: '2026-09-01', value: 0.2 },
        { fy: 2027, quarter: 2, kpi_definition_id: KPI_RATIO, kpi_version: 1, sort_order: 5, month: '2026-09-01', value: 0.5 },
      ],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    const helperOf = kpiId => grid.rows.find(r => r.kpiId === kpiId).helper
    expect(helperOf(KPI_SUM)).toBe("Enter the day's total.")
    expect(helperOf('k-latest')).toBe('Enter the figure at the end of the day. The window uses the latest one.')
    expect(helperOf('k-avg')).toBe("Enter the day's figure. The window uses the average of the days entered.")
    expect(helperOf('k-percent')).toBe(
      "Enter the day's figure. The window uses the average of the days entered. For a percent, enter 33 for 33%."
    )
    expect(helperOf(KPI_RATIO)).toBe("Enter the result and what it's out of, for example 3 out of 5.")
  })

  it('rows are ordered by sort_order, then by kpi id', () => {
    const kpiB = 'zz-later'
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [...allCells(kpiB), ...allCells(KPI_SUM)],
      entries: [],
      definitions: [{ ...defSum, id: kpiB, name: 'Later' }, defSum],
      targetRows: [
        { fy: 2027, quarter: 2, kpi_definition_id: kpiB, kpi_version: 1, sort_order: 5, month: '2026-09-01', value: 20 },
        ...targetRowsSum,
      ],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.rows.map(r => r.kpiId)).toEqual([KPI_SUM, kpiB])
  })

  it('a tied sort_order falls back to ordering by kpi id', () => {
    const kpiB = 'zz-later'
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [...allCells(kpiB), ...allCells(KPI_SUM)],
      entries: [],
      definitions: [{ ...defSum, id: kpiB, name: 'Later' }, defSum],
      targetRows: [
        { fy: 2027, quarter: 2, kpi_definition_id: kpiB, kpi_version: 1, sort_order: 1, month: '2026-09-01', value: 20 },
        ...targetRowsSum,
      ],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.rows.map(r => r.kpiId)).toEqual([KPI_SUM, kpiB])
  })

  it('a KPI with no sort_order (absent from targetRows) sorts last, by id', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [defSum],
      targetRows: [],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.rows.map(r => r.kpiId)).toEqual([KPI_SUM])
  })

  it('a KPI with a sort_order beats one with none, whichever side of the comparison it falls on', () => {
    const kpiB = 'zz-no-sort-order'
    const withSortOrder = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [...allCells(KPI_SUM), ...allCells(kpiB)],
      entries: [],
      definitions: [defSum, { ...defSum, id: kpiB, name: 'No sort order' }],
      targetRows: targetRowsSum, // only KPI_SUM has a sort_order
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(withSortOrder.rows.map(r => r.kpiId)).toEqual([KPI_SUM, kpiB])

    const kpiA = 'aa-no-sort-order'
    const reversed = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [...allCells(kpiA), ...allCells(KPI_SUM)],
      entries: [],
      definitions: [defSum, { ...defSum, id: kpiA, name: 'No sort order' }],
      targetRows: targetRowsSum, // only KPI_SUM has a sort_order
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(reversed.rows.map(r => r.kpiId)).toEqual([KPI_SUM, kpiA])
  })

  it('unapprovedQuarterLabels lists the quarters whose cells are not locked', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM, { scorecard_status: 'draft' }),
      entries: [],
      definitions: [defSum],
      targetRows: [],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.unapprovedQuarterLabels).toEqual(['Q2 FY27'])
  })

  it('unapprovedQuarterLabels skips a cell whose month is outside the supplied quarter rows', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM, { scorecard_status: 'draft' }),
      entries: [],
      definitions: [defSum],
      targetRows: [],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: [], // no month rows at all
    })
    expect(grid.unapprovedQuarterLabels).toEqual([])
  })

  it('unapprovedQuarterLabels is empty when every cell is locked', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.unapprovedQuarterLabels).toEqual([])
  })

  it('closedBefore is null when nothing is closed', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: allCells(KPI_SUM),
      entries: [],
      definitions: [defSum],
      targetRows: targetRowsSum,
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.closedBefore).toBeNull()
  })

  it('days carry the week’s dates, labels, and isToday', () => {
    const grid = buildEntryGrid({
      weekStart: WEEK_START,
      today: TODAY,
      cells: [],
      entries: [],
      definitions: [],
      targetRows: [],
      calendar: CALENDAR,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(grid.days).toHaveLength(7)
    expect(grid.days[0]).toEqual({ date: '2026-09-21', label: 'Mon 21 Sep', isToday: false })
    expect(grid.days[3]).toEqual({ date: '2026-09-24', label: 'Thu 24 Sep', isToday: true })
  })
})
