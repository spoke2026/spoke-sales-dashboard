import { describe, it, expect } from 'vitest'
import { STATUS, KpiEngineError, evaluateKpi, windowTargets } from './status.js'
import { KpiEngineError as CalendarError, todayInAuckland, eachDate } from './calendar.js'
import { buildCalendar } from './__fixtures__/calendar.js'
import { EXAMPLES, TODAY_INSTANT, CALENDAR, row, ratioRow } from './__fixtures__/examples.js'

const TODAY = todayInAuckland(new Date(TODAY_INSTANT))
// Jul to Oct 2026 with Matariki (10 Jul) and Labour Day (26 Oct).
const JUL_OCT = buildCalendar('2026-07-01', '2026-10-31', ['2026-07-10', '2026-10-26'])
const SEPTEMBER = { start: '2026-09-01', end: '2026-09-30' }
const SEP = v => [{ month: '2026-09-01', value: v }]

const def = (aggregation, direction, phasing = 'working_days') => ({ direction, aggregation, phasing })
const run = (overrides = {}) =>
  evaluateKpi({
    definition: def('sum', 'higher'),
    window: SEPTEMBER,
    today: TODAY,
    calendar: CALENDAR,
    targets: SEP(20),
    actuals: [],
    ...overrides,
  })

function codeOf(fn) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(KpiEngineError)
    return e.code
  }
  return 'NO_THROW'
}

it('today is Thu 24 Sep 2026 in Auckland', () => {
  expect(TODAY).toBe('2026-09-24')
})

describe('PRD §8.8 worked examples', () => {
  for (const ex of EXAMPLES) {
    it(ex.name, () => {
      for (const input of ex.cases) {
        const result = evaluateKpi({ ...input, today: TODAY, calendar: CALENDAR })
        for (const [key, value] of Object.entries(ex.expected)) {
          expect(result[key], `${ex.name} ${key}`).toBe(value)
        }
      }
    })
  }
})

describe('divergence tests (each fails under a named naive implementation)', () => {
  it('average/lower, target 24, actual 22 → GREEN [fails if averages are prorated]', () => {
    const r = run({ definition: def('average', 'lower'), targets: SEP(24), actuals: [ratioRow('2026-09-10', 44, 2)] })
    expect(r.actual).toBe(22)
    expect(r.targetToDate).toBe(24)
    expect(r.status).toBe(STATUS.GREEN)
    expect(r.reason).toBe('MET')
  })

  it('ratio/lower, target 0.05, denominator 0 → RED MISSING [fails if a zero denominator is treated as 0]', () => {
    const r = run({ definition: def('ratio', 'lower'), targets: SEP(0.05), actuals: [ratioRow('2026-09-10', 0, 0)] })
    expect(r.status).toBe(STATUS.RED)
    expect(r.reason).toBe('MISSING')
    expect(r.actual).toBe(null)
    expect(r.missing).toBe(true)
  })

  it('average/higher, target 0, no rows → GREEN ZERO_TARGET [fails if the zero-target rule is dropped or put after the missing rule]', () => {
    const r = run({ definition: def('average', 'higher'), targets: SEP(0), actuals: [] })
    expect(r.status).toBe(STATUS.GREEN)
    expect(r.reason).toBe('ZERO_TARGET')
    expect(r.actual).toBe(null)
    expect(r.missing).toBe(true)
  })

  it('sum/lower, target 10, no rows, in-progress → GREEN MET, missing true [fails if a missing sum is forced to RED]', () => {
    const r = run({ definition: def('sum', 'lower'), targets: SEP(10), actuals: [] })
    expect(r.windowState).toBe('IN_PROGRESS')
    expect(r.actual).toBe(0)
    expect(r.missing).toBe(true)
    expect(r.status).toBe(STATUS.GREEN)
    expect(r.reason).toBe('MET')
  })

  it('latest/higher, 10 Sep = 5 and 22 Sep = 1, target 3 → RED [fails if the first row is used instead of the last]', () => {
    const r = run({
      definition: def('latest', 'higher'),
      targets: SEP(3),
      actuals: [row('2026-09-10', 5), row('2026-09-22', 1)],
    })
    expect(r.actual).toBe(1)
    expect(r.status).toBe(STATUS.RED)
    expect(r.reason).toBe('NOT_MET')
  })

  // Found with a scratch script: adding T / monthDays monthDays times drifts.
  //   Aug 2026 (21 working days), T = 18 → 18.000000000000004 (over)
  //   Sep 2026 (22 working days), T = 20 → 19.999999999999996 (under)
  it('closed-month float trap: actual === T is GREEN for lower and higher [fails under per-day summation]', () => {
    const drift = (t, n) => { let s = 0; for (let i = 0; i < n; i++) s += t / n; return s }
    expect(drift(18, 21)).not.toBe(18)
    expect(drift(20, 22)).not.toBe(20)
    const traps = [
      { window: { start: '2026-08-01', end: '2026-08-31' }, targets: [{ month: '2026-08-01', value: 18 }], actual: 18 },
      { window: SEPTEMBER, targets: SEP(20), actual: 20, today: '2026-10-05' },
    ]
    for (const trap of traps) {
      for (const direction of ['lower', 'higher']) {
        const r = run({
          definition: def('sum', direction),
          window: trap.window,
          targets: trap.targets,
          today: trap.today ?? TODAY,
          actuals: [row(trap.window.start, trap.actual)],
        })
        expect(r.windowState, `${trap.window.start} ${direction}`).toBe('CLOSED')
        expect(r.targetToDate, `${trap.window.start} ${direction}`).toBe(trap.actual)
        expect(r.status, `${trap.window.start} ${direction}`).toBe(STATUS.GREEN)
      }
    }
  })

  it('calendar_days phasing: September target 30, today 24 Sep → targetToDate 24 exactly [fails if calendar_days reads working days]', () => {
    const r = run({ definition: def('sum', 'higher', 'calendar_days'), targets: SEP(30), calendar: undefined })
    expect(r.targetToDate).toBe(24)
    expect(r.fullTarget).toBe(30)
  })
})

describe('window states', () => {
  it('IN_PROGRESS when today is inside the window', () => {
    expect(run().windowState).toBe('IN_PROGRESS')
  })
  it('NOT_STARTED when today is before the window: nothing elapsed, target to date 0', () => {
    const r = run({
      window: { start: '2026-10-01', end: '2026-10-31' },
      calendar: JUL_OCT,
      targets: [{ month: '2026-10-01', value: 21 }],
      actuals: [row('2026-10-02', 5)],
    })
    expect(r.windowState).toBe('NOT_STARTED')
    expect(r.targetToDate).toBe(0)
    expect(r.fullTarget).toBe(21)
    expect(r.actual).toBe(0)
    expect(r.missing).toBe(true)
    expect(r.reason).toBe('ZERO_TARGET')
  })
  it('NOT_STARTED average KPI takes the target of the window start month', () => {
    const r = run({
      definition: def('average', 'lower'),
      window: { start: '2026-10-01', end: '2026-10-31' },
      targets: [{ month: '2026-10-01', value: 12 }],
    })
    expect(r.windowState).toBe('NOT_STARTED')
    expect(r.targetToDate).toBe(12)
    expect(r.reason).toBe('MISSING')
  })
  it('CLOSED when today is after the window', () => {
    const r = run({ window: { start: '2026-08-01', end: '2026-08-31' }, targets: [{ month: '2026-08-01', value: 18 }] })
    expect(r.windowState).toBe('CLOSED')
    expect(r.fullTarget).toBe(18)
  })
})

describe('windows and phasing', () => {
  it('a window crossing into October sums each month with its own working days (Labour Day 26 Oct)', () => {
    const r = run({
      window: { start: '2026-09-21', end: '2026-10-31' },
      today: '2026-10-28',
      calendar: JUL_OCT,
      targets: [{ month: '2026-09-01', value: 20 }, { month: '2026-10-01', value: 30 }],
      actuals: [row('2026-09-21', 10), row('2026-10-28', 25)],
    })
    // Sep 21 to 30: 8 of 22 working days. Oct 1 to 28: 19 of 21 (Labour Day off).
    expect(r.targetToDate).toBe(20 * 8 / 22 + 30 * 19 / 21)
    expect(r.fullTarget).toBe(20 * 8 / 22 + 30)
    expect(r.actual).toBe(35)
    expect(r.status).toBe(STATUS.GREEN)
  })
  it('a weekend "today" window has target 0, so higher is GREEN ZERO_TARGET', () => {
    const r = run({ window: { start: '2026-09-26', end: '2026-09-26' }, today: '2026-09-26' })
    expect(r.targetToDate).toBe(0)
    expect(r.status).toBe(STATUS.GREEN)
    expect(r.reason).toBe('ZERO_TARGET')
  })
  it('a month with no working days contributes 0 (monthDays === 0)', () => {
    const allOff = eachDate('2026-12-01', '2026-12-31')
    const calendar = buildCalendar('2026-12-01', '2026-12-31', allOff)
    const lower = run({
      definition: def('sum', 'lower'),
      window: { start: '2026-12-01', end: '2026-12-31' },
      today: '2027-01-05',
      calendar,
      targets: [{ month: '2026-12-01', value: 10 }],
    })
    expect(lower.targetToDate).toBe(0)
    expect(lower.fullTarget).toBe(0)
    expect(lower.status).toBe(STATUS.GREEN)
    expect(lower.reason).toBe('MET')
  })
  it('windowTargets can be called directly', () => {
    expect(windowTargets({
      phasing: 'working_days', calendar: CALENDAR, targets: SEP(22), start: '2026-09-01', end: '2026-09-30', today: TODAY,
    })).toEqual({ targetToDate: 18, fullTarget: 22 })
  })
})

describe('actuals', () => {
  it('ignores rows outside the elapsed range (before start, after today)', () => {
    const r = run({ actuals: [row('2026-08-31', 100), row('2026-09-02', 17), row('2026-09-25', 100)] })
    expect(r.actual).toBe(17)
  })
  it('sum skips rows whose value is null, and is missing when every row is null-valued', () => {
    const r = run({ actuals: [ratioRow('2026-09-02', 1, 1)] })
    expect(r.actual).toBe(0)
    expect(r.missing).toBe(true)
  })
  it('sum/lower over target is RED NOT_MET', () => {
    const r = run({ definition: def('sum', 'lower'), targets: SEP(10), actuals: [row('2026-09-02', 20)] })
    expect(r.status).toBe(STATUS.RED)
    expect(r.reason).toBe('NOT_MET')
  })
  it('ratio is Σnumerator ÷ Σdenominator and skips value-only rows', () => {
    const r = run({
      definition: def('ratio', 'higher'),
      targets: SEP(0.33),
      actuals: [ratioRow('2026-09-02', 1, 3), ratioRow('2026-09-03', 1, 1), row('2026-09-04', 9)],
    })
    expect(r.actual).toBe(0.5)
    expect(r.missing).toBe(false)
    expect(r.status).toBe(STATUS.GREEN)
  })
  it('latest picks the greatest date regardless of row order and skips null values', () => {
    const r = run({
      definition: def('latest', 'higher'),
      targets: SEP(3),
      actuals: [row('2026-09-22', 4), ratioRow('2026-09-23', 1, 1), row('2026-09-10', 1)],
    })
    expect(r.actual).toBe(4)
    expect(r.status).toBe(STATUS.GREEN)
  })
  it('latest with no valued rows is RED MISSING', () => {
    const r = run({ definition: def('latest', 'lower'), targets: SEP(3), actuals: [ratioRow('2026-09-02', 1, 1)] })
    expect(r.actual).toBe(null)
    expect(r.missing).toBe(true)
    expect(r.reason).toBe('MISSING')
  })
})

describe('errors', () => {
  it('STATUS is frozen and has only GREEN and RED', () => {
    expect(Object.isFrozen(STATUS)).toBe(true)
    expect(Object.keys(STATUS)).toEqual(['GREEN', 'RED'])
  })
  it('re-exports KpiEngineError from calendar.js', () => {
    expect(KpiEngineError).toBe(CalendarError)
  })
  it('INVALID_INPUT for an unknown direction, aggregation or phasing', () => {
    expect(codeOf(() => run({ definition: def('sum', 'up') }))).toBe('INVALID_INPUT')
    expect(codeOf(() => run({ definition: def('median', 'higher') }))).toBe('INVALID_INPUT')
    expect(codeOf(() => run({ definition: def('sum', 'higher', 'weekdays') }))).toBe('INVALID_INPUT')
  })
  it('INVALID_INPUT for a bad start, end or today', () => {
    expect(codeOf(() => run({ window: { start: '2026-09-31', end: '2026-09-30' } }))).toBe('INVALID_INPUT')
    expect(codeOf(() => run({ window: { start: '2026-09-01', end: 'end' } }))).toBe('INVALID_INPUT')
    expect(codeOf(() => run({ today: new Date(TODAY_INSTANT) }))).toBe('INVALID_INPUT')
  })
  it('INVALID_INPUT when start > end', () => {
    expect(codeOf(() => run({ window: { start: '2026-09-30', end: '2026-09-01' } }))).toBe('INVALID_INPUT')
  })
  it('INVALID_INPUT when actuals or targets are not arrays', () => {
    expect(codeOf(() => run({ actuals: null }))).toBe('INVALID_INPUT')
    expect(codeOf(() => run({ targets: { month: '2026-09-01', value: 20 } }))).toBe('INVALID_INPUT')
  })
  it('INVALID_CALENDAR for bad calendar rows', () => {
    expect(codeOf(() => run({ calendar: [{ date: '2026-09-01', is_working_day: 'yes' }] }))).toBe('INVALID_CALENDAR')
  })
  it('CALENDAR_GAP when the calendar does not cover every touched month in full', () => {
    expect(codeOf(() => run({
      window: { start: '2026-09-28', end: '2026-10-04' },
      targets: [{ month: '2026-09-01', value: 20 }, { month: '2026-10-01', value: 21 }],
    }))).toBe('CALENDAR_GAP')
    const partial = buildCalendar('2026-09-01', '2026-09-24')
    expect(codeOf(() => run({ calendar: partial, window: { start: '2026-09-01', end: '2026-09-24' } }))).toBe('CALENDAR_GAP')
  })
  it('MISSING_TARGET when a touched month has no target (sum and average)', () => {
    expect(codeOf(() => run({ window: { start: '2026-08-01', end: '2026-09-30' } }))).toBe('MISSING_TARGET')
    expect(codeOf(() => run({ definition: def('average', 'lower'), targets: [{ month: '2026-08-01', value: 1 }] }))).toBe('MISSING_TARGET')
  })
  it('INVALID_TARGET for two rows in a month, or a value that is not a finite number of 0 or more', () => {
    expect(codeOf(() => run({ targets: [...SEP(20), ...SEP(21)] }))).toBe('INVALID_TARGET')
    for (const value of [-1, '20', null, NaN, Infinity]) {
      expect(codeOf(() => run({ targets: SEP(value) })), String(value)).toBe('INVALID_TARGET')
    }
  })
  it('INVALID_ACTUAL for a row that is null or has a bad date', () => {
    expect(codeOf(() => run({ actuals: [null] }))).toBe('INVALID_ACTUAL')
    expect(codeOf(() => run({ actuals: ['2026-09-02'] }))).toBe('INVALID_ACTUAL')
    expect(codeOf(() => run({ actuals: [row('2026-09-31', 1)] }))).toBe('INVALID_ACTUAL')
  })
  it('INVALID_ACTUAL for a present numeric field that is not a finite number (callers convert types)', () => {
    expect(codeOf(() => run({ actuals: [row('2026-09-02', '5')] }))).toBe('INVALID_ACTUAL')
    expect(codeOf(() => run({ actuals: [row('2026-09-02', Infinity)] }))).toBe('INVALID_ACTUAL')
    expect(codeOf(() => run({ actuals: [{ date: '2026-09-02', value: 5 }] }))).toBe('INVALID_ACTUAL')
    expect(codeOf(() => run({ actuals: [{ ...ratioRow('2026-09-02', 1, 2), numerator: '1' }] }))).toBe('INVALID_ACTUAL')
  })
  it('INVALID_ACTUAL for average or ratio rows with exactly one of numerator and denominator', () => {
    const avg = def('average', 'lower')
    expect(codeOf(() => run({ definition: avg, actuals: [ratioRow('2026-09-02', 1, null)] }))).toBe('INVALID_ACTUAL')
    expect(codeOf(() => run({ definition: avg, actuals: [ratioRow('2026-09-02', null, 1)] }))).toBe('INVALID_ACTUAL')
  })
  it('INVALID_ACTUAL for a negative denominator', () => {
    expect(codeOf(() => run({ definition: def('ratio', 'higher'), actuals: [ratioRow('2026-09-02', 1, -1)] }))).toBe('INVALID_ACTUAL')
  })
  it('does not mutate its inputs', () => {
    const input = {
      definition: def('sum', 'higher'), window: { ...SEPTEMBER }, today: TODAY,
      calendar: CALENDAR.map(r => ({ ...r })), targets: SEP(20), actuals: [row('2026-09-02', 3)],
    }
    const snapshot = JSON.stringify(input)
    evaluateKpi(input)
    expect(JSON.stringify(input)).toBe(snapshot)
  })
})
