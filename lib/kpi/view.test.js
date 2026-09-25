import { describe, it, expect } from 'vitest'
import {
  CONNECTED_SOURCES,
  readActualNumber,
  toEngineActuals,
  fetchAllRows,
  planKpiWindow,
  judgeKpi,
  buildPersonScorecard,
  formatVariance,
  statusDisplay,
} from './view.js'
import { STATUS, KpiEngineError } from './status.js'
import { buildCalendar } from './__fixtures__/calendar.js'

// Test-only. Mirrors kpi_quarter_months(): FY N runs April (N-1) to March N.
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

function targetRow(kpiId, fy, quarter, month, value, version = 1, sortOrder = 1) {
  return {
    fy,
    quarter,
    scorecard_id: `sc-${fy}-${quarter}`,
    assignment_id: `as-${kpiId}-${month}`,
    kpi_definition_id: kpiId,
    kpi_version: version,
    sort_order: sortOrder,
    month,
    value,
  }
}

function actualRow(kpiId, date, value) {
  return { kpi_definition_id: kpiId, date, value, numerator: null, denominator: null }
}

function ratioActualRow(kpiId, date, numerator, denominator) {
  return { kpi_definition_id: kpiId, date, value: null, numerator, denominator }
}

function def(id, overrides) {
  return {
    id,
    version: 1,
    name: 'KPI',
    kpi_type: 'lead',
    unit: 'count',
    direction: 'higher',
    aggregation: 'sum',
    phasing: 'calendar_days',
    source: 'manual',
    ...overrides,
  }
}

describe('readActualNumber', () => {
  it("readActualNumber('-5') === -5, readActualNumber('abc') is NaN, readActualNumber(null) === null [fails if negatives are rejected or NaN becomes 0]", () => {
    expect(readActualNumber('-5')).toBe(-5)
    expect(Number.isNaN(readActualNumber('abc'))).toBe(true)
    expect(readActualNumber(null)).toBeNull()
  })

  it('undefined is also null-like', () => {
    expect(readActualNumber(undefined)).toBeNull()
  })

  it('a finite number passes through, a non-finite number is NaN', () => {
    expect(readActualNumber(5)).toBe(5)
    expect(Number.isNaN(readActualNumber(Infinity))).toBe(true)
  })

  it('a value that is neither a number nor a matching string is NaN', () => {
    expect(Number.isNaN(readActualNumber({}))).toBe(true)
    expect(Number.isNaN(readActualNumber(true))).toBe(true)
  })

  it('a positive decimal string parses', () => {
    expect(readActualNumber('12.5')).toBe(12.5)
  })
})

describe('toEngineActuals', () => {
  it('maps raw rows through readActualNumber without mutating them', () => {
    const rows = [{ date: '2026-09-01', value: '5', numerator: null, denominator: null, extra: 'x' }]
    const out = toEngineActuals(rows)
    expect(out).toEqual([{ date: '2026-09-01', value: 5, numerator: null, denominator: null }])
    expect(rows[0].extra).toBe('x')
  })
})

describe('fetchAllRows', () => {
  it('over a fake of 2,500 rows returns 2,500 [fails if it stops after one page]', async () => {
    const total = 2500
    const fetchPage = async (from, to) => {
      const rows = []
      for (let i = from; i <= Math.min(to, total - 1); i++) rows.push({ i })
      return { data: rows, error: null }
    }
    const result = await fetchAllRows(fetchPage)
    expect(result.error).toBeUndefined()
    expect(result.data).toHaveLength(2500)
  })

  it('returns the error from a failing second page', async () => {
    const fakeError = { message: 'boom' }
    let call = 0
    const fetchPage = async () => {
      call += 1
      if (call === 1) return { data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null }
      return { data: null, error: fakeError }
    }
    const result = await fetchAllRows(fetchPage)
    expect(result.error).toBe(fakeError)
  })

  it('gives up after maxPages when every page comes back full', async () => {
    const fetchPage = async () => ({ data: Array.from({ length: 10 }, (_, i) => ({ i })), error: null })
    const result = await fetchAllRows(fetchPage, { pageSize: 10, maxPages: 3 })
    expect(result.data).toBeUndefined()
    expect(result.error).toBeInstanceOf(Error)
  })
})

describe('formatVariance', () => {
  it("formatVariance('count', -1) === '−1' (U+2212), 8 → '+8', 0 → '0'", () => {
    expect(formatVariance('count', -1)).toBe('−1')
    expect(formatVariance('count', 8)).toBe('+8')
    expect(formatVariance('count', 0)).toBe('0')
  })

  it("formatVariance('hours', -2/3) === '−0.67 hours'", () => {
    expect(formatVariance('hours', -2 / 3)).toBe('−0.67 hours')
  })
})

describe('statusDisplay', () => {
  it('GREEN', () => {
    expect(statusDisplay(STATUS.GREEN)).toEqual({ symbol: '✓', label: 'On target', tone: 'green' })
  })

  it('RED', () => {
    expect(statusDisplay(STATUS.RED)).toEqual({ symbol: '✗', label: 'Off target', tone: 'red' })
  })
})

describe('judgeKpi', () => {
  it('a calendar gap gives error copy and status null, not RED [fails if engine errors are coloured]', () => {
    const kpiId = 'k-gap'
    const calendar = buildCalendar('2026-09-02', '2026-09-30') // missing 2026-09-01
    const plan = {
      kind: 'judge',
      start: '2026-09-01',
      end: '2026-09-30',
      trimmed: false,
      targets: [{ month: '2026-09-01', value: 20 }],
      pinned: { kpiVersion: 1, sortOrder: 1 },
    }
    const judged = judgeKpi({
      plan,
      definition: def(kpiId, { phasing: 'working_days' }),
      today: '2026-09-24',
      calendar,
      actuals: [],
    })
    expect(judged.ok).toBe(false)
    expect(judged.code).toBe('CALENDAR_GAP')
  })

  it('rethrows anything that is not a KpiEngineError', () => {
    expect(() =>
      judgeKpi({
        plan: { kind: 'judge', start: '2026-09-01', end: '2026-09-30', trimmed: false, targets: [] },
        definition: undefined,
        today: '2026-09-24',
        calendar: undefined,
        actuals: [],
      })
    ).toThrow(TypeError)
  })
})

describe('planKpiWindow', () => {
  it('no approved month → none', () => {
    const plan = planKpiWindow({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2026-09-24',
      targetRows: [],
      quarterMonthRows: FY27_ROWS,
    })
    expect(plan).toEqual({ kind: 'none' })
  })

  it('a KPI approved only in a future quarter is not listed [fails if listed]', () => {
    const kpiId = 'k-future'
    const targetRows = ['2026-10-01', '2026-11-01', '2026-12-01'].map((m, i) =>
      targetRow(kpiId, 2027, 3, m, 10)
    )
    const plan = planKpiWindow({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2026-09-24',
      targetRows,
      quarterMonthRows: FY27_ROWS,
    })
    expect(plan).toEqual({ kind: 'none' })
  })

  it('FY window, only Q3 approved, today in Q3 → judge 1 Oct to 31 Dec, trimmed true [fails without trailing trim: MISSING_TARGET]', () => {
    const kpiId = 'k-q3'
    const targetRows = ['2026-10-01', '2026-11-01', '2026-12-01'].map(m => targetRow(kpiId, 2027, 3, m, 10))
    const plan = planKpiWindow({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2026-11-15',
      targetRows,
      quarterMonthRows: FY27_ROWS,
    })
    expect(plan.kind).toBe('judge')
    expect(plan.start).toBe('2026-10-01')
    expect(plan.end).toBe('2026-12-31')
    expect(plan.trimmed).toBe(true)
  })

  it("Q1 and Q3 approved, Q2 not, FY window → gap, RED, \"Q2 FY27 has no approved target for this KPI, so it's red for this window.\" [fails if gaps are trimmed or skipped]", () => {
    const kpiId = 'k-gap-quarter'
    const targetRows = [
      ...['2026-04-01', '2026-05-01', '2026-06-01'].map(m => targetRow(kpiId, 2027, 1, m, 10)),
      ...['2026-10-01', '2026-11-01', '2026-12-01'].map(m => targetRow(kpiId, 2027, 3, m, 10)),
    ]
    const plan = planKpiWindow({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2026-11-15',
      targetRows,
      quarterMonthRows: FY27_ROWS,
    })
    expect(plan.kind).toBe('gap')
    expect(plan.gapQuarterLabels).toEqual(['Q2 FY27'])

    const scorecard = buildPersonScorecard({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2026-11-15',
      calendar: undefined,
      targetRows,
      definitions: [def(kpiId, { phasing: 'calendar_days' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [
        { fy: 2027, quarter: 1, status: 'locked' },
        { fy: 2027, quarter: 3, status: 'locked' },
      ],
    })
    expect(scorecard.cards).toHaveLength(1)
    expect(scorecard.cards[0].status).toBe('RED')
    expect(scorecard.cards[0].notes).toEqual([
      "Q2 FY27 has no approved target for this KPI, so it's red for this window.",
    ])
  })

  it('a gap month absent from quarterMonthRows altogether is skipped when labelling', () => {
    const kpiId = 'k-gap-unknown'
    const targetRows = [targetRow(kpiId, 2027, 1, '2026-04-01', 10), targetRow(kpiId, 2027, 1, '2026-06-01', 10)]
    const rowsWithoutMay = FY27_ROWS.filter(r => r.month !== '2026-05-01')
    const plan = planKpiWindow({
      window: { start: '2026-04-01', end: '2026-06-30' },
      today: '2026-06-15',
      targetRows,
      quarterMonthRows: rowsWithoutMay,
    })
    expect(plan.kind).toBe('gap')
    expect(plan.gapQuarterLabels).toEqual([])
  })

  it('the trimmed window starting after today is not listed', () => {
    const kpiId = 'k-not-started'
    const targetRows = ['2026-10-01', '2026-11-01', '2026-12-01'].map(m => targetRow(kpiId, 2027, 3, m, 10))
    const plan = planKpiWindow({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2026-09-24',
      targetRows,
      quarterMonthRows: FY27_ROWS,
    })
    expect(plan).toEqual({ kind: 'none' })
  })

  it('a window entirely inside one already-approved month needs no trim', () => {
    const kpiId = 'k-notrim'
    const targetRows = [targetRow(kpiId, 2027, 2, '2026-09-01', 20)]
    const plan = planKpiWindow({
      window: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-24',
      targetRows,
      quarterMonthRows: FY27_ROWS,
    })
    expect(plan.kind).toBe('judge')
    expect(plan.trimmed).toBe(false)
    expect(plan.start).toBe('2026-09-01')
    expect(plan.end).toBe('2026-09-30')
  })
})

describe('D14: the not-connected override', () => {
  const kpiId = 'k-hubspot'
  const monthTargets = ['2026-07-01', '2026-08-01', '2026-09-01']

  function scorecardFor(direction, aggregation, targetValue, source = 'hubspot') {
    const targetRows = monthTargets.map(m => targetRow(kpiId, 2027, 2, m, targetValue))
    return buildPersonScorecard({
      window: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-24',
      calendar: undefined,
      targetRows,
      definitions: [def(kpiId, { direction, aggregation, phasing: 'calendar_days', source })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
    })
  }

  it('higher sum, target 10, no rows → RED with the Not connected copy [fails if the override is missing or ignores the result]', () => {
    const scorecard = scorecardFor('higher', 'sum', 10)
    expect(scorecard.cards[0].status).toBe('RED')
    expect(scorecard.cards[0].notes).toContain(
      'Not connected yet. This KPI has no data until its data source is connected, so it shows red.'
    )
  })

  it('lower sum, target 10, no rows → RED, not the engine’s own GREEN [mutation 33]', () => {
    const scorecard = scorecardFor('lower', 'sum', 10)
    expect(scorecard.cards[0].status).toBe('RED')
    expect(scorecard.cards[0].notes).toContain(
      'Not connected yet. This KPI has no data until its data source is connected, so it shows red.'
    )
  })

  it('average and ratio KPIs with a non-zero target and no rows are RED independent of direction, confirming status.js’s own missing handling (manual source, no override involved)', () => {
    const avg = buildPersonScorecard({
      window: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-24',
      calendar: undefined,
      targetRows: monthTargets.map(m => targetRow(kpiId, 2027, 2, m, 24)),
      definitions: [def(kpiId, { direction: 'higher', aggregation: 'average', phasing: 'calendar_days', source: 'manual' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
    })
    expect(avg.cards[0].status).toBe('RED')
    expect(avg.cards[0].notes).not.toContain(
      'Not connected yet. This KPI has no data until its data source is connected, so it shows red.'
    )

    const ratio = buildPersonScorecard({
      window: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-24',
      calendar: undefined,
      targetRows: monthTargets.map(m => targetRow(kpiId, 2027, 2, m, 24)),
      definitions: [def(kpiId, { direction: 'lower', aggregation: 'ratio', phasing: 'calendar_days', source: 'manual' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
    })
    expect(ratio.cards[0].status).toBe('RED')
  })

  it('hubspot average, higher, target 0, no rows → RED with the Not connected copy [fails if the override is limited to sum]', () => {
    const scorecard = scorecardFor('higher', 'average', 0)
    expect(scorecard.cards[0].status).toBe('RED')
    expect(scorecard.cards[0].notes).toContain(
      'Not connected yet. This KPI has no data until its data source is connected, so it shows red.'
    )
    expect(scorecard.cards[0].notes).not.toContain('The target for this window is 0, so it counts as on target.')
  })

  it('hubspot latest, higher, target 0, no rows → RED with the Not connected copy [fails if the override is limited to sum]', () => {
    const scorecard = scorecardFor('higher', 'latest', 0)
    expect(scorecard.cards[0].status).toBe('RED')
    expect(scorecard.cards[0].notes).toContain(
      'Not connected yet. This KPI has no data until its data source is connected, so it shows red.'
    )
  })

  it('a manual higher sum KPI with target 0 and no rows stays GREEN with the zero-target and missing notes (never overridden)', () => {
    const scorecard = scorecardFor('higher', 'sum', 0, 'manual')
    expect(scorecard.cards[0].status).toBe('GREEN')
    expect(scorecard.cards[0].notes).toEqual([
      'No actuals entered for this window.',
      'The target for this window is 0, so it counts as on target.',
    ])
  })
})

describe('version pinning', () => {
  it('Q1 pins version 1 (higher), Q2 pins version 2 (lower): the FY card uses version 2 [fails if the first month’s version is used]', () => {
    const kpiId = 'k-version'
    const targetRows = [
      ...['2026-04-01', '2026-05-01', '2026-06-01'].map(m => targetRow(kpiId, 2027, 1, m, 20, 1)),
      ...['2026-07-01', '2026-08-01', '2026-09-01'].map(m => targetRow(kpiId, 2027, 2, m, 20, 2)),
    ]
    const definitions = [
      def(kpiId, { version: 1, name: 'V1', direction: 'higher', phasing: 'calendar_days' }),
      def(kpiId, { version: 2, name: 'V2', direction: 'lower', phasing: 'calendar_days' }),
    ]
    const scorecard = buildPersonScorecard({
      window: { start: '2026-04-01', end: '2026-09-30' },
      today: '2026-09-24',
      calendar: undefined,
      targetRows,
      definitions,
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [
        { fy: 2027, quarter: 1, status: 'locked' },
        { fy: 2027, quarter: 2, status: 'locked' },
      ],
    })
    expect(scorecard.cards[0].version).toBe(2)
    expect(scorecard.cards[0].name).toBe('V2')
  })
})

describe('PRD acceptance: manual-only scorecard, in progress', () => {
  const TODAY = '2026-09-24'
  const CALENDAR = buildCalendar('2026-04-01', '2026-09-30', [
    '2026-04-03', '2026-04-06', '2026-04-27', '2026-06-01', '2026-07-10',
  ])
  const kpiA = 'kpi-a-visits'
  const kpiB = 'kpi-b-turnaround'

  const targetsA = [
    ['2026-04-01', 19], ['2026-05-01', 21], ['2026-06-01', 21],
    ['2026-07-01', 15], ['2026-08-01', 18], ['2026-09-01', 20],
  ]
  const targetsB = [
    ['2026-04-01', 24], ['2026-05-01', 24], ['2026-06-01', 24],
    ['2026-07-01', 24], ['2026-08-01', 24], ['2026-09-01', 24],
  ]

  function fyQuarterOf(month) {
    return month <= '2026-06-01' ? 1 : 2
  }

  const targetRowsA = targetsA.map(([m, v]) => targetRow(kpiA, 2027, fyQuarterOf(m), m, v, 1, 1))
  const targetRowsB = targetsB.map(([m, v]) => targetRow(kpiB, 2027, fyQuarterOf(m), m, v, 1, 2))
  const targetRows = [...targetRowsA, ...targetRowsB]

  const actualsA = [
    actualRow(kpiA, '2026-06-30', 64),
    actualRow(kpiA, '2026-07-31', 15),
    actualRow(kpiA, '2026-08-31', 16),
    actualRow(kpiA, '2026-09-10', 13),
    actualRow(kpiA, '2026-09-21', 1),
    actualRow(kpiA, '2026-09-22', 1),
    actualRow(kpiA, '2026-09-23', 2),
  ]
  const actualsB = [
    ratioActualRow(kpiB, '2026-04-15', 60, 1),
    ratioActualRow(kpiB, '2026-05-15', 60, 1),
    ratioActualRow(kpiB, '2026-07-15', 20, 1),
    ratioActualRow(kpiB, '2026-09-03', 12, 1),
    ratioActualRow(kpiB, '2026-09-04', 12, 1),
    ratioActualRow(kpiB, '2026-09-07', 12, 1),
    ratioActualRow(kpiB, '2026-09-22', 40, 1),
    ratioActualRow(kpiB, '2026-09-23', 34, 1),
    ratioActualRow(kpiB, '2026-09-24', 10, 1),
  ]
  const actuals = [...actualsA, ...actualsB]

  const defA = def(kpiA, { name: 'Visits', unit: 'count', direction: 'higher', aggregation: 'sum', phasing: 'working_days' })
  const defB = def(kpiB, {
    name: 'Turnaround', unit: 'hours', direction: 'lower', aggregation: 'average', phasing: 'working_days',
  })

  const scorecards = [
    { fy: 2027, quarter: 1, status: 'locked' },
    { fy: 2027, quarter: 2, status: 'locked' },
  ]

  function judge(kpiId, definition, window) {
    const rows = kpiId === kpiA ? targetRowsA : targetRowsB
    const plan = planKpiWindow({ window, today: TODAY, targetRows: rows, quarterMonthRows: FY27_ROWS })
    expect(plan.kind).toBe('judge')
    const kpiActuals = (kpiId === kpiA ? actualsA : actualsB).map(r => ({
      date: r.date,
      value: r.value,
      numerator: r.numerator,
      denominator: r.denominator,
    }))
    const judged = judgeKpi({ plan, definition, today: TODAY, calendar: CALENDAR, actuals: kpiActuals })
    expect(judged.ok).toBe(true)
    return judged.result
  }

  it('Today', () => {
    const window = { start: TODAY, end: TODAY }
    const a = judge(kpiA, defA, window)
    expect(a.targetToDate).toBe((20 * 1) / 22)
    expect(a.actual).toBe(0)
    expect(a.status).toBe('RED')

    const b = judge(kpiB, defB, window)
    expect(b.targetToDate).toBe(24)
    expect(b.actual).toBe(10)
    expect(b.status).toBe('GREEN')
  })

  it('This week (Mon 21 to Sun 27 Sep)', () => {
    const window = { start: '2026-09-21', end: '2026-09-27' }
    const a = judge(kpiA, defA, window)
    expect(a.targetToDate).toBe((20 * 4) / 22)
    expect(a.fullTarget).toBe((20 * 5) / 22)
    expect(a.actual).toBe(4)
    expect(a.status).toBe('GREEN')

    const b = judge(kpiB, defB, window)
    expect(b.actual).toBe(84 / 3)
    expect(b.status).toBe('RED')
  })

  it('This month (September 2026)', () => {
    const window = { start: '2026-09-01', end: '2026-09-30' }
    const a = judge(kpiA, defA, window)
    expect(a.targetToDate).toBe((20 * 18) / 22)
    expect(a.fullTarget).toBe(20)
    expect(a.actual).toBe(17)
    expect(a.status).toBe('GREEN')

    const b = judge(kpiB, defB, window)
    expect(b.actual).toBe(120 / 6)
    expect(b.status).toBe('GREEN')
  })

  it('This quarter (Q2 FY27, Jul to Sep)', () => {
    const window = { start: '2026-07-01', end: '2026-09-30' }
    const a = judge(kpiA, defA, window)
    expect(a.targetToDate).toBe(15 + 18 + (20 * 18) / 22)
    expect(a.fullTarget).toBe(15 + 18 + 20)
    expect(a.actual).toBe(48)
    expect(a.status).toBe('RED')

    const b = judge(kpiB, defB, window)
    expect(b.actual).toBe(140 / 7)
    expect(b.status).toBe('GREEN')
  })

  it('This FY (trimmed to 1 Apr to 30 Sep, since Q3 and Q4 FY27 have no scorecard)', () => {
    const window = { start: '2026-04-01', end: '2027-03-31' }
    const planA = planKpiWindow({ window, today: TODAY, targetRows: targetRowsA, quarterMonthRows: FY27_ROWS })
    expect(planA.kind).toBe('judge')
    expect(planA.start).toBe('2026-04-01')
    expect(planA.end).toBe('2026-09-30')
    expect(planA.trimmed).toBe(true)

    const a = judge(kpiA, defA, window)
    expect(a.targetToDate).toBe(19 + 21 + 21 + (15 + 18 + (20 * 18) / 22))
    expect(a.fullTarget).toBe(19 + 21 + 21 + (15 + 18 + 20))
    expect(a.actual).toBe(112)
    expect(a.status).toBe('GREEN')

    const b = judge(kpiB, defB, window)
    expect(b.actual).toBe(260 / 9)
    expect(b.status).toBe('RED')

    // End-to-end wiring: buildPersonScorecard agrees, and marks the card
    // trimmed with the D9-worded note. No quarter note: Q3/Q4 FY27 haven't
    // started yet at TODAY, so there's nothing to flag (D10's rationale).
    const scorecard = buildPersonScorecard({
      window,
      today: TODAY,
      calendar: CALENDAR,
      targetRows,
      definitions: [defA, defB],
      actuals,
      quarterMonthRows: FY27_ROWS,
      scorecards,
    })
    expect(scorecard.quarterNote).toBeNull()
    expect(scorecard.empty).toBe(false)
    const cardA = scorecard.cards.find(c => c.kpiId === kpiA)
    const cardB = scorecard.cards.find(c => c.kpiId === kpiB)
    expect(cardA.status).toBe('GREEN')
    expect(cardA.notes).toContain(
      'Judged from 1 April 2026 to 30 September 2026, the months this KPI has an approved target.'
    )
    expect(cardB.status).toBe('RED')
    expect(cardB.notes).toContain('Judged against the full monthly target, not a share of it.')
  })
})

describe('buildQuarterNote (D11)', () => {
  const kpiId = 'k-note'

  function scenario({ today, scorecards, window }) {
    const targetRows = [targetRow(kpiId, 2027, 1, '2026-04-01', 10)]
    return buildPersonScorecard({
      window,
      today,
      calendar: undefined,
      targetRows,
      definitions: [def(kpiId, { phasing: 'calendar_days' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards,
    })
  }

  it('lists a started quarter with no locked scorecard, judging months that do', () => {
    const result = scenario({
      today: '2026-11-15',
      window: { start: '2026-04-01', end: '2026-09-30' },
      scorecards: [{ fy: 2027, quarter: 1, status: 'locked' }],
    })
    expect(result.quarterNote).toBe(
      'Q2 FY27 has no approved scorecard, so this window only judges the months that do.'
    )
  })

  it('two started quarters with no locked scorecard use "have" and joining with "and"', () => {
    const targetRows = ['2026-07-01', '2026-08-01', '2026-09-01'].map(m => targetRow(kpiId, 2027, 2, m, 10))
    const result = buildPersonScorecard({
      window: { start: '2026-07-01', end: '2027-03-31' },
      today: '2027-02-15',
      calendar: undefined,
      targetRows,
      definitions: [def(kpiId, { phasing: 'calendar_days' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
    })
    expect(result.empty).toBe(false)
    expect(result.quarterNote).toBe(
      'Q3 FY27 and Q4 FY27 have no approved scorecard, so this window only judges the months that do.'
    )
  })

  it('when nothing is left to judge, uses the empty-window wording', () => {
    const result = scenario({
      today: '2026-08-15',
      window: { start: '2026-07-01', end: '2026-09-30' },
      scorecards: [],
    })
    expect(result.empty).toBe(true)
    expect(result.quarterNote).toBe("Q2 FY27 has no approved scorecard, so there's nothing to judge for this window.")
  })

  it('a quarter that has not started yet is never mentioned', () => {
    const result = scenario({
      today: '2026-05-15',
      window: { start: '2026-04-01', end: '2026-12-31' },
      scorecards: [{ fy: 2027, quarter: 1, status: 'locked' }],
    })
    expect(result.quarterNote).toBeNull()
  })

  it('three or more missing quarters join with an Oxford comma', () => {
    const targetRows = ['2026-04-01', '2026-05-01', '2026-06-01'].map(m => targetRow(kpiId, 2027, 1, m, 10))
    const result = buildPersonScorecard({
      window: { start: '2026-04-01', end: '2027-03-31' },
      today: '2027-03-15',
      calendar: undefined,
      targetRows,
      definitions: [def(kpiId, { phasing: 'calendar_days' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 1, status: 'locked' }],
    })
    expect(result.quarterNote).toBe(
      'Q2 FY27, Q3 FY27, and Q4 FY27 have no approved scorecard, so this window only judges the months that do.'
    )
  })

  it('a quarter the window does not touch is never mentioned', () => {
    const result = scenario({
      today: '2026-05-15',
      window: { start: '2026-04-01', end: '2026-06-30' },
      scorecards: [{ fy: 2027, quarter: 1, status: 'locked' }],
    })
    expect(result.quarterNote).toBeNull()
  })
})

describe('an engine error becomes a status-less error card', () => {
  it('shows the fixed copy and no badge, without throwing', () => {
    const kpiId = 'k-error'
    const targetRows = [targetRow(kpiId, 2027, 2, '2026-09-01', 20)]
    const calendar = buildCalendar('2026-09-02', '2026-09-30')
    const scorecard = buildPersonScorecard({
      window: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-24',
      calendar,
      targetRows,
      definitions: [def(kpiId, { phasing: 'working_days' })],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
    })
    expect(scorecard.cards[0].status).toBeNull()
    expect(scorecard.cards[0].error).toBe("We couldn't work out this KPI's status. Tell the admin.")
    expect(scorecard.cards[0].figures).toBeNull()
  })

  it('a target row whose pinned definition did not load throws MISSING_DEFINITION, never a coloured card [rule 8]', () => {
    const kpiId = 'k-no-definition'
    const run = () =>
      buildPersonScorecard({
        window: { start: '2026-09-01', end: '2026-09-30' },
        today: '2026-09-24',
        calendar: buildCalendar('2026-09-01', '2026-09-30'),
        targetRows: [targetRow(kpiId, 2027, 2, '2026-09-01', 20)],
        definitions: [],
        actuals: [],
        quarterMonthRows: FY27_ROWS,
        scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
      })
    expect(run).toThrow(KpiEngineError)
    try {
      run()
    } catch (e) {
      expect(e.code).toBe('MISSING_DEFINITION')
    }
  })
})

describe('card ordering', () => {
  it('sorts by sort_order, then falls back to name when sort_order ties', () => {
    const kpiZ = 'k-zebra'
    const kpiA = 'k-apple'
    const targetRows = [
      targetRow(kpiZ, 2027, 2, '2026-09-01', 10, 1, 1),
      targetRow(kpiA, 2027, 2, '2026-09-01', 10, 1, 1),
    ]
    const scorecard = buildPersonScorecard({
      window: { start: '2026-09-01', end: '2026-09-30' },
      today: '2026-09-24',
      calendar: undefined,
      targetRows,
      definitions: [
        def(kpiZ, { name: 'Zebra', phasing: 'calendar_days' }),
        def(kpiA, { name: 'Apple', phasing: 'calendar_days' }),
      ],
      actuals: [],
      quarterMonthRows: FY27_ROWS,
      scorecards: [{ fy: 2027, quarter: 2, status: 'locked' }],
    })
    expect(scorecard.cards.map(c => c.name)).toEqual(['Apple', 'Zebra'])
  })
})

describe('CONNECTED_SOURCES', () => {
  it('is frozen and holds only manual', () => {
    expect(CONNECTED_SOURCES).toEqual(['manual'])
    expect(Object.isFrozen(CONNECTED_SOURCES)).toBe(true)
  })
})

describe('KpiEngineError re-export', () => {
  it('is the same class calendar.js throws', () => {
    expect(new KpiEngineError('X', 'x')).toBeInstanceOf(KpiEngineError)
  })
})

// THE ACCEPTANCE DATASET (the brief's live, closed-window table), proved here
// through the same buildPersonScorecard the person page calls, before any
// screen exists. Two KPIs that disagree in every window except 10 Mar, so a
// swapped, inverted, or all-one-colour defect fails.
describe('PRD acceptance, live dataset: FY26 Q3 and Q4 locked, every window closed', () => {
  // Labour Day, Christmas, Boxing Day, New Year, and Waitangi Day give
  // Oct 22, Nov 20, Dec 21, Jan 20, Feb 19, Mar 22 working days.
  const calendar = buildCalendar('2025-04-01', '2026-03-31', [
    '2025-10-27', '2025-12-25', '2025-12-26', '2026-01-01', '2026-01-02', '2026-02-06',
  ])
  const quarterMonthRows = buildQuarterMonthRows([2026, 2027])
  const TODAY_LIVE = '2026-09-25'
  const COUNT = 'c0000000-0000-0000-0000-000000000001'
  const HOURS = 'c0000000-0000-0000-0000-000000000002'
  const definitions = [
    { id: COUNT, version: 1, name: 'ZZ Test entry count', kpi_type: 'lead', unit: 'count', direction: 'higher', aggregation: 'sum', phasing: 'working_days', source: 'manual' },
    { id: HOURS, version: 1, name: 'ZZ Test entry hours', kpi_type: 'lead', unit: 'hours', direction: 'lower', aggregation: 'average', phasing: 'working_days', source: 'manual' },
  ]
  const countTargets = { '2025-10-01': 22, '2025-11-01': 20, '2025-12-01': 21, '2026-01-01': 20, '2026-02-01': 19, '2026-03-01': 22 }
  const quarterOf = month => quarterMonthRows.find(r => r.month === month)
  const allTargetRows = Object.keys(countTargets).flatMap(month => [
    { ...quarterOf(month), kpi_definition_id: COUNT, kpi_version: 1, sort_order: 0, month, value: countTargets[month] },
    { ...quarterOf(month), kpi_definition_id: HOURS, kpi_version: 1, sort_order: 1, month, value: 24 },
  ])
  const count = (date, v) => ({ kpi_definition_id: COUNT, date, value: v, numerator: null, denominator: null })
  const hours = (date, v) => ({ kpi_definition_id: HOURS, date, value: v, numerator: v, denominator: 1 })
  const allActuals = [
    count('2025-10-31', 30), count('2025-11-28', 20), count('2025-12-23', 21), count('2026-01-30', 20),
    count('2026-02-27', 15), count('2026-03-02', 1), count('2026-03-03', 1), count('2026-03-04', 1),
    count('2026-03-05', 1), count('2026-03-06', 0), count('2026-03-13', 10), count('2026-03-31', 8),
    hours('2025-10-15', 60), hours('2025-11-17', 60), hours('2026-01-20', 10), hours('2026-02-10', 10),
    hours('2026-03-02', 20), hours('2026-03-03', 30), hours('2026-03-04', 20), hours('2026-03-16', 30),
    hours('2026-03-17', 30), hours('2026-03-18', 30),
  ]
  const scorecards = [
    { id: 's-q3', fy: 2026, quarter: 3, status: 'locked' },
    { id: 's-q4', fy: 2026, quarter: 4, status: 'locked' },
  ]

  // As the page does: kpi_window_targets returns the months the window
  // touches, and actuals are read for start to end only.
  function build(start, end) {
    const firstMonth = `${start.slice(0, 7)}-01`
    return buildPersonScorecard({
      window: { start, end },
      today: TODAY_LIVE,
      calendar,
      targetRows: allTargetRows.filter(r => r.month >= firstMonth && r.month <= end),
      definitions,
      actuals: allActuals.filter(a => a.date >= start && a.date <= end),
      quarterMonthRows,
      scorecards,
    })
  }

  const TABLE = [
    ['Tue 3 Mar 2026', '2026-03-03', '2026-03-03', ['1', '1', '1', '0', 'GREEN'], ['30 hours', '24 hours', '24 hours', '+6 hours', 'RED']],
    ['Tue 10 Mar 2026', '2026-03-10', '2026-03-10', ['0', '1', '1', '−1', 'RED'], ['No data', '24 hours', '24 hours', 'No data', 'RED']],
    ['Sat 7 Mar 2026', '2026-03-07', '2026-03-07', ['0', '0', '0', '0', 'GREEN'], ['No data', '24 hours', '24 hours', 'No data', 'RED']],
    ['Week 2 to 8 Mar', '2026-03-02', '2026-03-08', ['4', '5', '5', '−1', 'RED'], ['23.33 hours', '24 hours', '24 hours', '−0.67 hours', 'GREEN']],
    ['March 2026', '2026-03-01', '2026-03-31', ['22', '22', '22', '0', 'GREEN'], ['26.67 hours', '24 hours', '24 hours', '+2.67 hours', 'RED']],
    ['Q4 FY26', '2026-01-01', '2026-03-31', ['57', '61', '61', '−4', 'RED'], ['22.5 hours', '24 hours', '24 hours', '−1.5 hours', 'GREEN']],
    ['Q3 FY26', '2025-10-01', '2025-12-31', ['71', '63', '63', '+8', 'GREEN'], ['60 hours', '24 hours', '24 hours', '+36 hours', 'RED']],
    ['FY26', '2025-04-01', '2026-03-31', ['128', '124', '124', '+4', 'GREEN'], ['30 hours', '24 hours', '24 hours', '+6 hours', 'RED']],
  ]

  for (const [name, start, end, countRow, hoursRow] of TABLE) {
    it(`${name}: count ${countRow[4]}, hours ${hoursRow[4]}`, () => {
      const { cards } = build(start, end)
      expect(cards.map(c => c.name)).toEqual(['ZZ Test entry count', 'ZZ Test entry hours'])
      for (const [card, row] of [[cards[0], countRow], [cards[1], hoursRow]]) {
        const [actual, targetToDate, fullTarget, variance, status] = row
        expect(card.error).toBe(null)
        expect(card.figures).toEqual({ actual, targetToDate, fullTarget, variance })
        expect(card.status).toBe(status)
        expect(card.statusLabel).toBe(status === 'GREEN' ? 'On target' : 'Off target')
        expect(card.symbol).toBe(status === 'GREEN' ? '✓' : '✗')
      }
    })
  }

  it('10 Mar: the count card says no actuals; 7 Mar: no actuals and a 0 target', () => {
    expect(build('2026-03-10', '2026-03-10').cards[0].notes).toEqual(['No actuals entered for this window.'])
    expect(build('2026-03-07', '2026-03-07').cards[0].notes).toEqual([
      'No actuals entered for this window.',
      'The target for this window is 0, so it counts as on target.',
    ])
  })

  it('FY26 is judged 1 Oct 2025 to 31 Mar 2026, with the page note for Q1 and Q2', () => {
    const result = build('2025-04-01', '2026-03-31')
    for (const card of result.cards) {
      expect(card.notes[0]).toBe('Judged from 1 October 2025 to 31 March 2026, the months this KPI has an approved target.')
    }
    expect(result.quarterNote).toBe(
      'Q1 FY26 and Q2 FY26 have no approved scorecard, so this window only judges the months that do.'
    )
  })

  it('Q2 FY26 has no cards, the empty wording, and nothing to judge', () => {
    const result = build('2025-07-01', '2025-09-30')
    expect(result.cards).toEqual([])
    expect(result.empty).toBe(true)
    expect(result.quarterNote).toBe("Q2 FY26 has no approved scorecard, so there's nothing to judge for this window.")
  })
})
