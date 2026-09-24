// TEST-ONLY. The eight PRD §8.8 worked examples, shared by status.test.js and
// status.tz.test.js so both files run exactly the same setups (one copy, rule 7).
// Context: today is Thu 24 Sep 2026 in Pacific/Auckland, derived from the
// instant below through todayInAuckland. September 2026 has 22 working days;
// 18 have elapsed including today.

import { buildCalendar } from './calendar.js'

export const TODAY_INSTANT = '2026-09-23T14:00:00Z'

// Jul to Sep 2026, Matariki on Fri 10 Jul.
export const CALENDAR = buildCalendar('2026-07-01', '2026-09-30', ['2026-07-10'])

export const row = (date, value) => ({ date, value, numerator: null, denominator: null })
export const ratioRow = (date, numerator, denominator) => ({ date, value: null, numerator, denominator })

const SUM_HIGHER = { direction: 'higher', aggregation: 'sum', phasing: 'working_days' }
const Q2_TARGETS = [
  { month: '2026-07-01', value: 15 },
  { month: '2026-08-01', value: 18 },
  { month: '2026-09-01', value: 20 },
]
const SEPTEMBER = { start: '2026-09-01', end: '2026-09-30' }

// Each example: the evaluateKpi input (minus today) and the exact expected
// fields. `cases` holds more than one input where the PRD row has two setups.
export const EXAMPLES = [
  {
    name: '8.8 example 1',
    cases: [{
      definition: SUM_HIGHER, window: SEPTEMBER, targets: Q2_TARGETS,
      actuals: [row('2026-09-01', 10), row('2026-09-24', 7)],
    }],
    expected: { status: 'GREEN', reason: 'MET', actual: 17, targetToDate: 20 * 18 / 22 },
  },
  {
    name: '8.8 example 2',
    cases: [{
      definition: SUM_HIGHER, window: SEPTEMBER, targets: Q2_TARGETS,
      actuals: [row('2026-09-01', 16)],
    }],
    expected: { status: 'RED', reason: 'NOT_MET', actual: 16, targetToDate: 20 * 18 / 22 },
  },
  {
    name: '8.8 example 3',
    cases: [{
      definition: SUM_HIGHER, window: { start: '2026-07-01', end: '2026-09-30' }, targets: Q2_TARGETS,
      actuals: [row('2026-07-15', 15), row('2026-08-14', 18), row('2026-09-10', 15)],
    }],
    expected: { status: 'RED', reason: 'NOT_MET', actual: 48, targetToDate: 15 + 18 + 20 * 18 / 22 },
  },
  {
    name: '8.8 example 4',
    cases: [{
      definition: SUM_HIGHER, window: { start: '2026-09-21', end: '2026-09-27' }, targets: Q2_TARGETS,
      actuals: [row('2026-09-21', 1), row('2026-09-22', 1), row('2026-09-23', 1), row('2026-09-24', 1)],
    }],
    expected: { status: 'GREEN', reason: 'MET', actual: 4, targetToDate: 20 * 4 / 22, fullTarget: 20 * 5 / 22 },
  },
  {
    name: '8.8 example 5',
    cases: [{
      definition: SUM_HIGHER, window: { start: '2026-08-01', end: '2026-08-31' }, targets: Q2_TARGETS,
      actuals: [row('2026-08-10', 9), row('2026-08-31', 9)],
    }],
    expected: { status: 'GREEN', reason: 'MET', actual: 18, targetToDate: 18, windowState: 'CLOSED' },
  },
  {
    name: '8.8 example 6',
    cases: [{
      definition: { direction: 'lower', aggregation: 'average', phasing: 'working_days' },
      window: SEPTEMBER,
      targets: [{ month: '2026-09-01', value: 24 }],
      actuals: [ratioRow('2026-09-10', 52, 2)],
    }],
    expected: { status: 'RED', reason: 'NOT_MET', actual: 26, targetToDate: 24 },
  },
  {
    name: '8.8 example 7',
    cases: [{
      definition: SUM_HIGHER,
      window: { start: '2026-09-24', end: '2026-09-24' },
      targets: [{ month: '2026-09-01', value: 22 }],
      actuals: [],
    }],
    expected: { status: 'RED', reason: 'NOT_MET', actual: 0, missing: true, targetToDate: 1 },
  },
  {
    name: '8.8 example 8',
    cases: [
      {
        definition: { direction: 'higher', aggregation: 'ratio', phasing: 'working_days' },
        window: SEPTEMBER,
        targets: [{ month: '2026-09-01', value: 0.33 }],
        actuals: [ratioRow('2026-09-15', 0, 0)],
      },
      {
        definition: { direction: 'higher', aggregation: 'ratio', phasing: 'working_days' },
        window: SEPTEMBER,
        targets: [{ month: '2026-09-01', value: 0.33 }],
        actuals: [],
      },
    ],
    expected: { status: 'RED', reason: 'MISSING', actual: null, missing: true },
  },
]
