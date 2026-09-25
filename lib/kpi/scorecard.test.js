import { describe, test, expect } from 'vitest'
import {
  NOT_LINKED,
  STALE,
  FORBIDDEN,
  NOT_FOUND,
  SAVE_ERROR,
  STATUS_LABELS,
  statusLabel,
  formatQuarter,
  formatQuarterMonths,
  parseQuarterParam,
  quarterParam,
  quarterOptions,
  currentQuarter,
  isCompanyKpi,
  scorecardWarnings,
  validateScorecardCreate,
  validateLifecycle,
  validateAssignmentAdd,
  validateAssignmentRemove,
  validateTargetSave,
  cellField,
  targetUnchanged,
  planTargetInserts,
  mapScorecardDbError,
} from './scorecard.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const GENERIC = { ok: false, status: 400, error: "We couldn't save that. Try again." }
const TODAY = '2026-09-25'

// kpi_quarter_months() rows for FY27 (Apr 2026 to Mar 2027), in a scrambled
// order so sorting is exercised.
function fy27Rows() {
  const months = [
    [1, ['2026-04-01', '2026-05-01', '2026-06-01']],
    [2, ['2026-07-01', '2026-08-01', '2026-09-01']],
    [3, ['2026-10-01', '2026-11-01', '2026-12-01']],
    [4, ['2027-01-01', '2027-02-01', '2027-03-01']],
  ]
  const rows = []
  for (const [quarter, list] of months) for (const month of list) rows.push({ fy: 2027, quarter, month })
  return [rows[7], rows[0], rows[11], rows[3], rows[5], rows[1], rows[9], rows[2], rows[4], rows[6], rows[8], rows[10]]
}

describe('copy constants', () => {
  test('match the brief exactly', () => {
    expect(NOT_LINKED).toBe(
      "Your login isn't linked to a person yet. Ask the admin to add your email on People and teams."
    )
    expect(STALE).toBe("This scorecard changed since you opened it. Refresh the page to see where it's up to.")
    expect(FORBIDDEN).toBe("You can't make that change to this scorecard.")
    expect(NOT_FOUND).toBe('That scorecard no longer exists. Refresh the page.')
    expect(SAVE_ERROR).toBe("We couldn't save that. Try again.")
  })
})

describe('statusLabel', () => {
  test('labels the three statuses and never returns blank', () => {
    expect(STATUS_LABELS).toEqual({ draft: 'Draft', submitted: 'Submitted', locked: 'Locked' })
    expect(statusLabel('draft')).toBe('Draft')
    expect(statusLabel('submitted')).toBe('Submitted')
    expect(statusLabel('locked')).toBe('Locked')
    expect(statusLabel('banana')).toBe('Unknown')
    expect(statusLabel(undefined)).toBe('Unknown')
    expect(statusLabel('toString')).toBe('Unknown')
  })
})

describe('formatQuarter and formatQuarterMonths', () => {
  test("formatQuarter(2030, 1) === 'Q1 FY30' and formatQuarter(2027, 3) === 'Q3 FY27'", () => {
    expect(formatQuarter(2030, 1)).toBe('Q1 FY30')
    expect(formatQuarter(2027, 3)).toBe('Q3 FY27')
    expect(formatQuarter(2105, 2)).toBe('Q2 FY05')
  })
  test('three months read "October to December 2026"', () => {
    expect(formatQuarterMonths(['2026-10-01', '2026-11-01', '2026-12-01'])).toBe('October to December 2026')
    expect(formatQuarterMonths(['2029-01-01', '2029-02-01', '2029-03-01'])).toBe('January to March 2029')
  })
  test('any other length or shape is "Months unavailable"', () => {
    expect(formatQuarterMonths([])).toBe('Months unavailable')
    expect(formatQuarterMonths(['2026-10-01', '2026-11-01'])).toBe('Months unavailable')
    expect(formatQuarterMonths(null)).toBe('Months unavailable')
  })
})

describe('parseQuarterParam and quarterParam', () => {
  test('parses YYYY-Q within 2020 to 2100', () => {
    expect(parseQuarterParam('2027-3')).toEqual({ fy: 2027, quarter: 3 })
    expect(parseQuarterParam('2020-1')).toEqual({ fy: 2020, quarter: 1 })
    expect(parseQuarterParam('2100-4')).toEqual({ fy: 2100, quarter: 4 })
  })
  test('rejects everything else', () => {
    for (const v of ['banana', '2027-5', '2027-0', '2019-1', '2101-1', '2027-3 ', '27-3', '', undefined, null, 20273]) {
      expect(parseQuarterParam(v), String(v)).toBeNull()
    }
  })
  test('quarterParam round-trips', () => {
    expect(quarterParam(2027, 3)).toBe('2027-3')
    expect(parseQuarterParam(quarterParam(2029, 4))).toEqual({ fy: 2029, quarter: 4 })
  })
})

describe('quarterOptions and currentQuarter', () => {
  test('groups, sorts and labels', () => {
    const options = quarterOptions(fy27Rows(), TODAY)
    expect(options.map(o => o.param)).toEqual(['2027-1', '2027-2', '2027-3', '2027-4'])
    expect(options[2]).toEqual({
      fy: 2027,
      quarter: 3,
      months: ['2026-10-01', '2026-11-01', '2026-12-01'],
      param: '2027-3',
      label: 'Q3 FY27 (October to December 2026)',
      isCurrent: false,
      isPast: false,
    })
  })
  test("today '2026-09-30' marks Q2 FY27 current and Q1 FY27 past; '2026-10-01' marks Q3 FY27 current", () => {
    const a = quarterOptions(fy27Rows(), '2026-09-30')
    expect(a.find(o => o.quarter === 2).isCurrent).toBe(true)
    expect(a.find(o => o.quarter === 2).isPast).toBe(false)
    expect(a.find(o => o.quarter === 1).isPast).toBe(true)
    expect(a.find(o => o.quarter === 3).isCurrent).toBe(false)
    expect(currentQuarter(a).quarter).toBe(2)

    const b = quarterOptions(fy27Rows(), '2026-10-01')
    expect(b.find(o => o.quarter === 3).isCurrent).toBe(true)
    expect(b.find(o => o.quarter === 2).isCurrent).toBe(false)
    expect(b.find(o => o.quarter === 2).isPast).toBe(true)
    expect(currentQuarter(b).quarter).toBe(3)
  })
  test('sorts across FYs and does not mutate the rows', () => {
    const rows = [
      { fy: 2028, quarter: 1, month: '2027-04-01' },
      ...fy27Rows(),
    ]
    const copy = JSON.stringify(rows)
    const options = quarterOptions(rows, TODAY)
    expect(options.map(o => o.param)).toEqual(['2027-1', '2027-2', '2027-3', '2027-4', '2028-1'])
    expect(options[4].label).toBe('Q1 FY28 (Months unavailable)')
    expect(JSON.stringify(rows)).toBe(copy)
  })
  test('currentQuarter falls back to the first not past, then the last', () => {
    const before = quarterOptions(fy27Rows(), '2020-01-15')
    expect(before.every(o => !o.isCurrent)).toBe(true)
    expect(currentQuarter(before).param).toBe('2027-1')
    const after = quarterOptions(fy27Rows(), '2031-06-01')
    expect(after.every(o => o.isPast)).toBe(true)
    expect(currentQuarter(after).param).toBe('2027-4')
    expect(currentQuarter([])).toBeNull()
  })
})

describe('isCompanyKpi', () => {
  test('true only for attribution method company', () => {
    expect(isCompanyKpi({ attribution: { method: 'company', note: null } })).toBe(true)
    expect(isCompanyKpi({ attribution: { method: 'record_owner' } })).toBe(false)
    expect(isCompanyKpi({ attribution: null })).toBe(false)
    expect(isCompanyKpi({ attribution: ['company'] })).toBe(false)
    expect(isCompanyKpi({})).toBe(false)
    expect(isCompanyKpi(null)).toBe(false)
  })
})

describe('scorecardWarnings', () => {
  const lead = n => Array(n).fill('lead')
  const lag = n => Array(n).fill('lag')

  test('no KPIs', () => {
    expect(scorecardWarnings({ kpiTypes: [], missingTargets: 0 })).toEqual([
      'This scorecard has no KPIs yet. Add 5 to 8 from the library.',
    ])
  })
  test('1 KPI is singular, 3 is plural', () => {
    expect(scorecardWarnings({ kpiTypes: lead(1), missingTargets: 0 })).toEqual([
      'This scorecard has 1 KPI. Aim for 5 to 8.',
    ])
    expect(scorecardWarnings({ kpiTypes: lead(3), missingTargets: 0 })).toEqual([
      'This scorecard has 3 KPIs. Aim for 5 to 8.',
    ])
  })
  test('exactly 5 KPIs gives no count warning, and exactly 8 gives none (divergence: < 5 vs <= 5, > 8 vs >= 8)', () => {
    expect(scorecardWarnings({ kpiTypes: [...lead(3), ...lag(2)], missingTargets: 0 })).toEqual([])
    expect(scorecardWarnings({ kpiTypes: [...lead(4), ...lag(4)], missingTargets: 0 })).toEqual([])
    expect(scorecardWarnings({ kpiTypes: lead(4), missingTargets: 0 })).toEqual([
      'This scorecard has 4 KPIs. Aim for 5 to 8.',
    ])
    expect(scorecardWarnings({ kpiTypes: lead(9), missingTargets: 0 })).toEqual([
      'This scorecard has 9 KPIs. Aim for 5 to 8, so each one gets attention.',
    ])
  })
  test('2 lead and 2 lag gives no balance warning (divergence: lead <= lag)', () => {
    const w = scorecardWarnings({ kpiTypes: ['lead', 'lag', 'lag', 'lead'], missingTargets: 0 })
    expect(w).toEqual(['This scorecard has 4 KPIs. Aim for 5 to 8.'])
  })
  test('fewer lead than lag, and the brief\'s three-KPI example in order', () => {
    expect(scorecardWarnings({ kpiTypes: ['lag', 'lead', 'lag'], missingTargets: 9 })).toEqual([
      'This scorecard has 3 KPIs. Aim for 5 to 8.',
      'It has fewer lead KPIs (1) than lag KPIs (2). Lead KPIs drive results, so aim for at least as many.',
      '9 monthly targets still empty. Every KPI needs a target for every month before approval. 0 is allowed.',
    ])
  })
  test('one missing target is singular', () => {
    expect(scorecardWarnings({ kpiTypes: [...lead(3), ...lag(3)], missingTargets: 1 })).toEqual([
      '1 monthly target still empty. Every KPI needs a target for every month before approval. 0 is allowed.',
    ])
  })
})

// Every validator: each key removed in turn, and one extra key added, is the
// generic error (rule 6).
function frozenBodyCases(name, validate, good) {
  test(`${name} rejects each key removed in turn and one extra key added (divergence: frozen body)`, () => {
    expect(validate(good()).ok, 'the good body passes').toBe(true)
    for (const key of Object.keys(good())) {
      const b = good()
      delete b[key]
      expect(validate(b), `without ${key}`).toEqual(GENERIC)
    }
    expect(validate({ ...good(), status: 'locked' }), 'extra key').toEqual(GENERIC)
    expect(validate(null)).toEqual(GENERIC)
    expect(validate([])).toEqual(GENERIC)
    expect(validate('x')).toEqual(GENERIC)
  })
}

const createBody = () => ({ personId: A, fy: 2029, quarter: 4 })
const lifecycleBody = (o = {}) => ({ id: A, action: 'submit', expectedStatus: 'draft', note: '', boardMeetingDate: '', ...o })
const addBody = (o = {}) => ({ scorecardId: A, kpiId: B, expectedStatus: 'draft', ...o })
const removeBody = (o = {}) => ({ assignmentId: A, expectedStatus: 'draft', ...o })
const saveBody = (o = {}) => ({
  scorecardId: A,
  expectedStatus: 'draft',
  reason: '',
  cells: [{ assignmentId: B, month: '2029-01-01', value: '20' }],
  ...o,
})

describe('validateScorecardCreate', () => {
  frozenBodyCases('validateScorecardCreate', validateScorecardCreate, createBody)
  test('accepts a person or null (company)', () => {
    expect(validateScorecardCreate(createBody())).toEqual({ ok: true, value: { personId: A, fy: 2029, quarter: 4 } })
    expect(validateScorecardCreate({ ...createBody(), personId: null }).value.personId).toBeNull()
  })
  test('rejects bad types and ranges', () => {
    for (const o of [
      { personId: 'nope' },
      { personId: 7 },
      { fy: '2029' },
      { fy: 2019 },
      { fy: 2101 },
      { fy: 2029.5 },
      { quarter: 0 },
      { quarter: 5 },
      { quarter: '4' },
    ]) {
      expect(validateScorecardCreate({ ...createBody(), ...o }), JSON.stringify(o)).toEqual(GENERIC)
    }
  })
})

describe('validateLifecycle', () => {
  frozenBodyCases('validateLifecycle', b => validateLifecycle(b, TODAY), lifecycleBody)

  test('submit and approve need empty note and date', () => {
    expect(validateLifecycle(lifecycleBody(), TODAY)).toEqual({
      ok: true,
      value: { id: A, action: 'submit', expectedStatus: 'draft', note: null, boardMeetingDate: null },
    })
    expect(validateLifecycle(lifecycleBody({ action: 'approve', expectedStatus: 'submitted' }), TODAY).ok).toBe(true)
    expect(validateLifecycle(lifecycleBody({ note: 'x' }), TODAY)).toEqual(GENERIC)
    expect(validateLifecycle(lifecycleBody({ note: ' ' }), TODAY)).toEqual(GENERIC)
    expect(validateLifecycle(lifecycleBody({ action: 'approve', boardMeetingDate: TODAY }), TODAY)).toEqual(GENERIC)
  })
  test('rejects bad id, action, status and types', () => {
    for (const o of [
      { id: 'x' },
      { action: 'unlock' },
      { action: 'exception_edit' },
      { expectedStatus: 'open' },
      { note: null },
      { boardMeetingDate: null },
    ]) {
      expect(validateLifecycle(lifecycleBody(o), TODAY), JSON.stringify(o)).toEqual(GENERIC)
    }
  })
  test('return needs a trimmed note of 1 to 500 characters and no date', () => {
    const ret = o => validateLifecycle(lifecycleBody({ action: 'return', expectedStatus: 'submitted', ...o }), TODAY)
    expect(ret({ note: '  ' })).toEqual({
      ok: false,
      status: 400,
      field: 'note',
      error: "Say what needs to change before it's resubmitted.",
    })
    expect(ret({ note: 'x'.repeat(501) })).toEqual({
      ok: false,
      status: 400,
      field: 'note',
      error: 'Keep the note under 500 characters.',
    })
    expect(ret({ note: 'x'.repeat(500) }).ok).toBe(true)
    expect(ret({ note: '  Lower October  ' }).value.note).toBe('Lower October')
    expect(ret({ note: 'x', boardMeetingDate: TODAY })).toEqual(GENERIC)
  })
  test('a board date equal to today is accepted and today + 1 is rejected', () => {
    const board = o =>
      validateLifecycle(
        lifecycleBody({ action: 'record_board_approval', expectedStatus: 'submitted', note: 'Minutes', ...o }),
        TODAY
      )
    expect(board({ boardMeetingDate: '2026-09-25' })).toEqual({
      ok: true,
      value: {
        id: A,
        action: 'record_board_approval',
        expectedStatus: 'submitted',
        note: 'Minutes',
        boardMeetingDate: '2026-09-25',
      },
    })
    const dateErr = {
      ok: false,
      status: 400,
      field: 'boardMeetingDate',
      error: "Enter the board meeting date. It can't be in the future.",
    }
    expect(board({ boardMeetingDate: '2026-09-26' })).toEqual(dateErr)
    expect(board({ boardMeetingDate: '' })).toEqual(dateErr)
    expect(board({ boardMeetingDate: '2026-02-30' })).toEqual(dateErr)
  })
  test('board date is checked before the reference, then the reference length', () => {
    const board = o =>
      validateLifecycle(lifecycleBody({ action: 'record_board_approval', expectedStatus: 'submitted', ...o }), TODAY)
    expect(board({ note: '', boardMeetingDate: '' }).field).toBe('boardMeetingDate')
    expect(board({ note: ' ', boardMeetingDate: '2026-09-24' })).toEqual({
      ok: false,
      status: 400,
      field: 'note',
      error: 'Enter the board meeting reference, for example Board minutes 14 Oct 2026.',
    })
    expect(board({ note: 'x'.repeat(201), boardMeetingDate: '2026-09-24' })).toEqual({
      ok: false,
      status: 400,
      field: 'note',
      error: 'Keep the reference under 200 characters.',
    })
    expect(board({ note: 'x'.repeat(200), boardMeetingDate: '2026-09-24' }).ok).toBe(true)
  })
})

describe('validateAssignmentAdd and validateAssignmentRemove', () => {
  frozenBodyCases('validateAssignmentAdd', validateAssignmentAdd, addBody)
  frozenBodyCases('validateAssignmentRemove', validateAssignmentRemove, removeBody)
  test('add: empty kpiId is a field error; a non-uuid is generic', () => {
    expect(validateAssignmentAdd(addBody())).toEqual({
      ok: true,
      value: { scorecardId: A, kpiId: B, expectedStatus: 'draft' },
    })
    expect(validateAssignmentAdd(addBody({ kpiId: '' }))).toEqual({
      ok: false,
      status: 400,
      field: 'kpiId',
      error: 'Choose a KPI to add.',
    })
    for (const o of [{ kpiId: 'x' }, { kpiId: 5 }, { scorecardId: 'x' }, { expectedStatus: 'x' }]) {
      expect(validateAssignmentAdd(addBody(o)), JSON.stringify(o)).toEqual(GENERIC)
    }
  })
  test('remove: needs a uuid and a status', () => {
    expect(validateAssignmentRemove(removeBody())).toEqual({ ok: true, value: { assignmentId: A, expectedStatus: 'draft' } })
    expect(validateAssignmentRemove(removeBody({ assignmentId: 'x' }))).toEqual(GENERIC)
    expect(validateAssignmentRemove(removeBody({ expectedStatus: 'gone' }))).toEqual(GENERIC)
  })
})

describe('validateTargetSave', () => {
  frozenBodyCases('validateTargetSave', validateTargetSave, saveBody)
  test('accepts and normalises the reason', () => {
    expect(validateTargetSave(saveBody())).toEqual({
      ok: true,
      value: {
        scorecardId: A,
        expectedStatus: 'draft',
        reason: null,
        cells: [{ assignmentId: B, month: '2029-01-01', value: '20' }],
      },
    })
    expect(validateTargetSave(saveBody({ reason: '  Board asked  ' })).value.reason).toBe('Board asked')
  })
  test('reason over 500 characters is a field error', () => {
    expect(validateTargetSave(saveBody({ reason: 'x'.repeat(501) }))).toEqual({
      ok: false,
      status: 400,
      field: 'reason',
      error: 'Keep the reason under 500 characters.',
    })
    expect(validateTargetSave(saveBody({ reason: 'x'.repeat(500) })).ok).toBe(true)
  })
  test('cells must be 1 to 90 exact objects, first-of-month, no duplicates', () => {
    const cell = (o = {}) => ({ assignmentId: B, month: '2029-01-01', value: '1', ...o })
    const ninety = Array.from({ length: 90 }, (_, i) => cell({ assignmentId: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111` }))
    expect(validateTargetSave(saveBody({ cells: ninety })).ok).toBe(true)
    for (const cells of [
      [],
      [...ninety, cell({ month: '2029-02-01' })],
      'x',
      [cell({ month: '2029-01-15' })],
      [cell({ month: '2029-13-01' })],
      [cell({ month: 'Jan' })],
      [cell({ value: 20 })],
      [cell({ assignmentId: 'x' })],
      [{ assignmentId: B, month: '2029-01-01' }],
      [{ ...cell(), extra: 1 }],
      [null],
      [cell(), cell()],
    ]) {
      expect(validateTargetSave(saveBody({ cells })), JSON.stringify(cells).slice(0, 80)).toEqual(GENERIC)
    }
    for (const o of [{ reason: null }, { scorecardId: 'x' }, { expectedStatus: 'x' }]) {
      expect(validateTargetSave(saveBody(o)), JSON.stringify(o)).toEqual(GENERIC)
    }
  })
})

describe('cellField and targetUnchanged', () => {
  test('cellField', () => {
    expect(cellField(A, '2029-01-01')).toBe(`cell:${A}:2029-01-01`)
  })
  test("'20.50' against stored 20.5, and '33.0' against stored 0.33 for percent, are unchanged (divergence: strings, stored units)", () => {
    expect(targetUnchanged('count', '20.50', 20.5)).toBe(true)
    expect(targetUnchanged('percent', '33.0', 0.33)).toBe(true)
    expect(targetUnchanged('percent', ' 33 ', 0.33)).toBe(true)
  })
  test("percent '33.3333' against stored 0.333333 is unchanged (divergence: toDisplayNumber's toFixed)", () => {
    expect(targetUnchanged('percent', '33.3333', 0.333333)).toBe(true)
    // 0.333333 * 100 happens to be exact in floating point, so on its own the
    // case above can't tell toFixed from no toFixed (rule 15). These drift:
    // 0.333 * 100 is 33.300000000000004 and 0.145 * 100 is 14.499999999999998.
    expect(targetUnchanged('percent', '33.3', 0.333)).toBe(true)
    expect(targetUnchanged('percent', '14.5', 0.145)).toBe(true)
  })
  test('different numbers, and unreadable stored values, are changed', () => {
    expect(targetUnchanged('count', '21', 20)).toBe(false)
    expect(targetUnchanged('percent', '0.33', 0.33)).toBe(false)
    expect(targetUnchanged('count', '20', NaN)).toBe(false)
    expect(targetUnchanged('count', '20', null)).toBe(false)
    expect(targetUnchanged('count', '20', '20')).toBe(false)
  })
})

describe('planTargetInserts', () => {
  const units = new Map([
    [A, 'count'],
    [B, 'percent'],
  ])
  const fA = m => cellField(A, m)
  const plan = (cells, current = new Map(), reason = null) =>
    planTargetInserts({ cells, unitByAssignment: units, currentByCell: current, reason })

  test("a '0' cell with no current value produces a row with value 0 (divergence: truthiness)", () => {
    expect(plan([{ assignmentId: A, month: '2029-01-01', value: '0' }])).toEqual({
      ok: true,
      rows: [{ assignment_id: A, month: '2029-01-01', value: 0, change_reason: null }],
    })
  })
  test('percent is stored as a fraction and the reason is carried', () => {
    expect(plan([{ assignmentId: B, month: '2029-02-01', value: '33' }], new Map(), 'Board asked')).toEqual({
      ok: true,
      rows: [{ assignment_id: B, month: '2029-02-01', value: 0.33, change_reason: 'Board asked' }],
    })
  })
  test('an empty cell with a current value 0 gives the "can\'t be cleared" error (divergence: 0 as no value)', () => {
    expect(plan([{ assignmentId: A, month: '2029-01-01', value: '' }], new Map([[fA('2029-01-01'), 0]]))).toEqual({
      ok: false,
      status: 400,
      field: fA('2029-01-01'),
      error: "Targets can't be cleared once saved. Enter 0 instead.",
    })
  })
  test('an empty cell with no current value is skipped', () => {
    expect(
      plan([
        { assignmentId: A, month: '2029-01-01', value: ' ' },
        { assignmentId: A, month: '2029-02-01', value: '5' },
      ])
    ).toEqual({ ok: true, rows: [{ assignment_id: A, month: '2029-02-01', value: 5, change_reason: null }] })
  })
  test('unchanged cells are skipped, compared in display units, strings read at the boundary', () => {
    const current = new Map([
      [fA('2029-01-01'), 20.5],
      [cellField(B, '2029-01-01'), 0.33],
      [fA('2029-02-01'), '7'],
    ])
    const r = plan(
      [
        { assignmentId: A, month: '2029-01-01', value: '20.50' },
        { assignmentId: B, month: '2029-01-01', value: '33.0' },
        { assignmentId: A, month: '2029-02-01', value: '7' },
        { assignmentId: A, month: '2029-03-01', value: '8' },
      ],
      current
    )
    expect(r).toEqual({ ok: true, rows: [{ assignment_id: A, month: '2029-03-01', value: 8, change_reason: null }] })
  })
  test('resending every saved value is "Nothing has changed"', () => {
    const current = new Map([[fA('2029-01-01'), 20.5]])
    expect(plan([{ assignmentId: A, month: '2029-01-01', value: '20.50' }], current)).toEqual({
      ok: false,
      status: 400,
      error: 'Nothing has changed. Edit a target or cancel.',
    })
  })
  test('bad text is a cell field error', () => {
    for (const value of ['-1', '1,000', 'abc', '1234567890123456']) {
      expect(plan([{ assignmentId: A, month: '2029-01-01', value }]), value).toEqual({
        ok: false,
        status: 400,
        field: fA('2029-01-01'),
        error: 'Enter a number of 0 or more, without commas or symbols.',
      })
    }
  })
  test('an assignment not on the scorecard is the generic error', () => {
    const other = '33333333-3333-4333-8333-333333333333'
    expect(plan([{ assignmentId: other, month: '2029-01-01', value: '1' }])).toEqual(GENERIC)
  })
  test('does not mutate its inputs', () => {
    const cells = [{ assignmentId: A, month: '2029-01-01', value: '3' }]
    const copy = JSON.stringify(cells)
    plan(cells)
    expect(JSON.stringify(cells)).toBe(copy)
  })
})

describe('mapScorecardDbError', () => {
  const m = (context, code) => mapScorecardDbError(context, { code, message: 'relation "kpi_scorecard" violates' })
  test('23505 depends on the context', () => {
    expect(m('create', '23505')).toEqual({
      status: 409,
      field: 'quarter',
      error: "There's already a scorecard for this quarter. Open it from the scorecards list.",
    })
    expect(m('assignment', '23505')).toEqual({ status: 409, field: 'kpiId', error: 'That KPI is already on this scorecard.' })
    expect(m('targets', '23505')).toEqual({ status: 409, error: STALE })
  })
  test('each code maps to its fixed copy', () => {
    expect(m('x', '23503')).toEqual({ status: 400, error: 'That person or KPI no longer exists. Refresh the page.' })
    for (const code of ['23514', 'KS009', 'KS011']) expect(m('x', code)).toEqual({ status: 400, error: SAVE_ERROR })
    for (const code of ['42501', 'KS001']) expect(m('x', code)).toEqual({ status: 403, error: FORBIDDEN })
    expect(m('x', 'KS002')).toEqual({
      status: 400,
      error: 'Every KPI needs a target for every month before approval. Fill in the empty months, or enter 0.',
    })
    expect(m('x', 'KS003')).toEqual({ status: 400, error: 'Add at least one KPI first.' })
    expect(m('x', 'KS004')).toEqual({
      status: 403,
      error: "You can't approve your own scorecard. Record the board's approval instead.",
    })
    expect(m('x', 'KS005')).toEqual({
      status: 400,
      error: 'Board approval is only for the company scorecard and your own scorecard.',
    })
    expect(m('x', 'KS006')).toEqual({
      status: 409,
      field: 'kpiId',
      error: "That KPI isn't available for new scorecards. Pick a published KPI.",
    })
    expect(m('x', 'KS007')).toEqual({
      status: 400,
      error:
        "This person doesn't have an individual scorecard. Check they're active and set to Individual on People and teams.",
    })
    expect(m('x', 'KS008')).toEqual({
      status: 400,
      field: 'quarter',
      error: "The working-day calendar doesn't cover that quarter.",
    })
    expect(m('x', 'KS010')).toEqual({
      status: 400,
      field: 'reason',
      error: 'Say why these targets are changing. The reason is saved in the audit log.',
    })
    expect(m('x', 'KS012')).toEqual({ status: 400, field: 'note', error: "Say what needs to change before it's resubmitted." })
    expect(m('x', 'KS013')).toEqual({
      status: 400,
      field: 'boardMeetingDate',
      error: "Enter the board meeting date. It can't be in the future.",
    })
    expect(m('x', 'KS014')).toEqual({
      status: 400,
      field: 'note',
      error: 'Enter the board meeting reference, for example Board minutes 14 Oct 2026.',
    })
  })
  test("mapScorecardDbError('lifecycle', { code: 'KS004', message: 'KS001' }) gives the KS004 copy (divergence: message text)", () => {
    expect(mapScorecardDbError('lifecycle', { code: 'KS004', message: 'KS001' })).toEqual({
      status: 403,
      error: "You can't approve your own scorecard. Record the board's approval instead.",
    })
  })
  test('unknown, missing, and non-object errors are 500 with no database text', () => {
    for (const e of [{ code: 'XX000', message: 'relation "kpi_target" does not exist' }, {}, null, 'boom', [{ code: 'KS001' }]]) {
      const r = mapScorecardDbError('x', e)
      expect(r).toEqual({ status: 500, error: SAVE_ERROR })
      expect(JSON.stringify(r)).not.toMatch(/relation|kpi_|KS0|XX000/)
    }
  })
})
