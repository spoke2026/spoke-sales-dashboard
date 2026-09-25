import { describe, it, expect } from 'vitest'
import {
  weekStartOf,
  parseWindowParams,
  resolveWindow,
  windowHref,
  windowOptions,
  WINDOW_NOTICES,
} from './window.js'
import { KpiEngineError } from './calendar.js'

// Mirrors kpi_quarter_months(): FY N runs April (N-1) to March N, in quarters
// Q1 Apr-Jun, Q2 Jul-Sep, Q3 Oct-Dec, Q4 Jan-Mar(N). Test-only fixture.
function buildQuarterMonthRows(fys, relabel = {}) {
  const rows = []
  for (const fy of fys) {
    const monthsOfFy = [
      [fy - 1, 4], [fy - 1, 5], [fy - 1, 6],
      [fy - 1, 7], [fy - 1, 8], [fy - 1, 9],
      [fy - 1, 10], [fy - 1, 11], [fy - 1, 12],
      [fy, 1], [fy, 2], [fy, 3],
    ]
    const label = Object.prototype.hasOwnProperty.call(relabel, fy) ? relabel[fy] : fy
    monthsOfFy.forEach(([y, m], i) => {
      const quarter = Math.floor(i / 3) + 1
      rows.push({ fy: label, quarter, month: `${y}-${String(m).padStart(2, '0')}-01` })
    })
  }
  return rows
}

const ROWS_26_29 = buildQuarterMonthRows([2026, 2027, 2028, 2029])

describe('weekStartOf', () => {
  it('today Sun 27 Sep 2026 → week Mon 21 Sep to Sun 27 Sep [fails if weeks start on Sunday]', () => {
    expect(weekStartOf('2026-09-27')).toBe('2026-09-21')
  })

  it('today Mon 28 Sep 2026 → 28 Sep to Sun 4 Oct', () => {
    expect(weekStartOf('2026-09-28')).toBe('2026-09-28')
  })

  it('every weekday resolves to the Monday on or before it', () => {
    expect(weekStartOf('2026-09-22')).toBe('2026-09-21')
    expect(weekStartOf('2026-09-23')).toBe('2026-09-21')
    expect(weekStartOf('2026-09-24')).toBe('2026-09-21')
    expect(weekStartOf('2026-09-25')).toBe('2026-09-21')
    expect(weekStartOf('2026-09-26')).toBe('2026-09-21')
  })
})

describe('parseWindowParams', () => {
  it('undefined → default', () => {
    expect(parseWindowParams({})).toEqual({ kind: 'default' })
  })

  it('array as window → invalid [fails if the first array element is used]', () => {
    expect(parseWindowParams({ window: ['week', 'month'] })).toEqual({ kind: 'invalid' })
  })

  it('a non-string, non-array window → invalid', () => {
    expect(parseWindowParams({ window: 42 })).toEqual({ kind: 'invalid' })
  })

  it('the five simple kinds', () => {
    for (const kind of ['today', 'week', 'month', 'quarter', 'fy']) {
      expect(parseWindowParams({ window: kind })).toEqual({ kind })
    }
  })

  it('m-YYYY-MM', () => {
    expect(parseWindowParams({ window: 'm-2026-10' })).toEqual({ kind: 'm', month: '2026-10-01' })
  })

  it('q-YYYY-N', () => {
    expect(parseWindowParams({ window: 'q-2026-3' })).toEqual({ kind: 'q', fy: 2026, quarter: 3 })
  })

  it('fy-YYYY', () => {
    expect(parseWindowParams({ window: 'fy-2026' })).toEqual({ kind: 'fyx', fy: 2026 })
  })

  it('range with two valid dates', () => {
    expect(parseWindowParams({ window: 'range', from: '2026-03-02', to: '2026-03-08' })).toEqual({
      kind: 'range',
      from: '2026-03-02',
      to: '2026-03-08',
    })
  })

  it('range with a missing or bad date → invalid', () => {
    expect(parseWindowParams({ window: 'range', from: '2026-03-02', to: 'banana' })).toEqual({ kind: 'invalid' })
    expect(parseWindowParams({ window: 'range', from: undefined, to: '2026-03-08' })).toEqual({ kind: 'invalid' })
  })

  it('an unmatched string → invalid', () => {
    expect(parseWindowParams({ window: 'banana' })).toEqual({ kind: 'invalid' })
    expect(parseWindowParams({ window: 'm-2026-13' })).toEqual({ kind: 'invalid' })
    expect(parseWindowParams({ window: 'q-2026-5' })).toEqual({ kind: 'invalid' })
  })
})

describe('resolveWindow', () => {
  it('throws CALENDAR_GAP when today is outside the rows', () => {
    expect(() => resolveWindow({ kind: 'month' }, '2020-01-01', ROWS_26_29)).toThrow(KpiEngineError)
  })

  it('default and month resolve to this month', () => {
    const r = resolveWindow({ kind: 'default' }, '2026-09-24', ROWS_26_29)
    expect(r.start).toBe('2026-09-01')
    expect(r.end).toBe('2026-09-30')
    expect(r.label).toBe('This month, September 2026')
    expect(r.chipKey).toBe('month')
    expect(r.notice).toBeNull()
  })

  it('invalid falls back to this month with the INVALID notice', () => {
    const r = resolveWindow({ kind: 'invalid' }, '2026-09-24', ROWS_26_29)
    expect(r.chipKey).toBe('month')
    expect(r.notice).toBe(WINDOW_NOTICES.INVALID)
  })

  it('today', () => {
    const r = resolveWindow({ kind: 'today' }, '2026-10-08', ROWS_26_29)
    expect(r.start).toBe('2026-10-08')
    expect(r.end).toBe('2026-10-08')
    expect(r.label).toBe('Today, Thu 8 Oct 2026')
    expect(r.chipKey).toBe('today')
  })

  it('week: same year', () => {
    const r = resolveWindow({ kind: 'week' }, '2026-10-08', ROWS_26_29)
    expect(r.start).toBe('2026-10-05')
    expect(r.end).toBe('2026-10-11')
    expect(r.label).toBe('This week, Mon 5 Oct to Sun 11 Oct 2026')
  })

  it('week: spanning two years shows both years', () => {
    const r = resolveWindow({ kind: 'week' }, '2026-01-01', ROWS_26_29)
    expect(r.start).toBe('2025-12-29')
    expect(r.end).toBe('2026-01-04')
    expect(r.label).toBe('This week, Mon 29 Dec 2025 to Sun 4 Jan 2026')
  })

  it('This quarter on 2026-09-30 is Q2 FY27 and on 2026-10-01 is Q3 FY27 [off-by-one at the boundary]', () => {
    const before = resolveWindow({ kind: 'quarter' }, '2026-09-30', ROWS_26_29)
    expect(before.label).toBe('This quarter, Q2 FY27 (July to September 2026)')
    expect(before.start).toBe('2026-07-01')
    expect(before.end).toBe('2026-09-30')

    const after = resolveWindow({ kind: 'quarter' }, '2026-10-01', ROWS_26_29)
    expect(after.label).toBe('This quarter, Q3 FY27 (October to December 2026)')
    expect(after.start).toBe('2026-10-01')
    expect(after.end).toBe('2026-12-31')
  })

  it('This FY', () => {
    const r = resolveWindow({ kind: 'fy' }, '2026-10-01', ROWS_26_29)
    expect(r.label).toBe('This FY, FY27 (April 2026 to March 2027)')
    expect(r.start).toBe('2026-04-01')
    expect(r.end).toBe('2027-03-31')
    expect(r.chipKey).toBe('fy')
  })

  it('quarter rows relabelled to FY 9999 prove This FY comes from the rows [fails if FY is computed in JS]', () => {
    const rows = buildQuarterMonthRows([2026, 2027, 2028], { 2027: 9999 })
    const r = resolveWindow({ kind: 'fy' }, '2026-10-01', rows)
    expect(r.label).toBe('This FY, FY99 (April 2026 to March 2027)')
  })

  it('m-2026-10 with today 2026-09-30 → NOT_STARTED fallback; with today 2026-10-01 → October 2026 [fails if future windows are allowed]', () => {
    const before = resolveWindow({ kind: 'm', month: '2026-10-01' }, '2026-09-30', ROWS_26_29)
    expect(before.notice).toBe(WINDOW_NOTICES.NOT_STARTED)
    expect(before.chipKey).toBe('month')

    const after = resolveWindow({ kind: 'm', month: '2026-10-01' }, '2026-10-01', ROWS_26_29)
    expect(after.notice).toBeNull()
    expect(after.label).toBe('October 2026')
    expect(after.chipKey).toBe('m-2026-10')
    expect(after.start).toBe('2026-10-01')
    expect(after.end).toBe('2026-10-31')
  })

  it('m outside the calendar rows → INVALID', () => {
    const r = resolveWindow({ kind: 'm', month: '2020-01-01' }, '2026-09-24', ROWS_26_29)
    expect(r.notice).toBe(WINDOW_NOTICES.INVALID)
  })

  it('q: valid, not started, and unknown', () => {
    const valid = resolveWindow({ kind: 'q', fy: 2026, quarter: 3 }, '2026-10-01', ROWS_26_29)
    expect(valid.label).toBe('Q3 FY26 (October to December 2025)')
    expect(valid.chipKey).toBe('q-2026-3')

    const notStarted = resolveWindow({ kind: 'q', fy: 2027, quarter: 4 }, '2026-09-24', ROWS_26_29)
    expect(notStarted.notice).toBe(WINDOW_NOTICES.NOT_STARTED)

    const unknown = resolveWindow({ kind: 'q', fy: 2099, quarter: 1 }, '2026-09-24', ROWS_26_29)
    expect(unknown.notice).toBe(WINDOW_NOTICES.INVALID)
  })

  it('fyx: valid, not started, and unknown', () => {
    const valid = resolveWindow({ kind: 'fyx', fy: 2026 }, '2026-09-24', ROWS_26_29)
    expect(valid.label).toBe('FY26 (April 2025 to March 2026)')
    expect(valid.chipKey).toBeNull()

    const notStarted = resolveWindow({ kind: 'fyx', fy: 2028 }, '2026-09-24', ROWS_26_29)
    expect(notStarted.notice).toBe(WINDOW_NOTICES.NOT_STARTED)

    const unknown = resolveWindow({ kind: 'fyx', fy: 2099 }, '2026-09-24', ROWS_26_29)
    expect(unknown.notice).toBe(WINDOW_NOTICES.INVALID)
  })

  describe('custom range', () => {
    it('accepted, and single date when from = to', () => {
      const r = resolveWindow({ kind: 'range', from: '2026-03-02', to: '2026-03-08' }, '2026-09-24', ROWS_26_29)
      expect(r.label).toBe('Mon 2 Mar 2026 to Sun 8 Mar 2026')
      expect(r.notice).toBeNull()
      expect(r.chipKey).toBeNull()

      const single = resolveWindow({ kind: 'range', from: '2026-03-02', to: '2026-03-02' }, '2026-09-24', ROWS_26_29)
      expect(single.label).toBe('Mon 2 Mar 2026')
    })

    it('from after to → RANGE_ORDER', () => {
      const r = resolveWindow({ kind: 'range', from: '2026-03-08', to: '2026-03-02' }, '2026-09-24', ROWS_26_29)
      expect(r.notice).toBe(WINDOW_NOTICES.RANGE_ORDER)
    })

    it('366 days is accepted and 367 days is RANGE_LONG [fails if the cap is off by one]', () => {
      const rows = buildQuarterMonthRows([2026, 2027, 2028])
      const ok = resolveWindow({ kind: 'range', from: '2026-04-01', to: '2027-04-01' }, '2027-09-24', rows)
      expect(ok.notice).toBeNull()
      expect(ok.start).toBe('2026-04-01')
      expect(ok.end).toBe('2027-04-01')

      const long = resolveWindow({ kind: 'range', from: '2026-04-01', to: '2027-04-02' }, '2027-09-24', rows)
      expect(long.notice).toBe(WINDOW_NOTICES.RANGE_LONG)
    })

    it('from after today → NOT_STARTED', () => {
      const r = resolveWindow({ kind: 'range', from: '2026-10-01', to: '2026-10-05' }, '2026-09-24', ROWS_26_29)
      expect(r.notice).toBe(WINDOW_NOTICES.NOT_STARTED)
    })

    it('dates outside the calendar → RANGE_CALENDAR with the calendar bounds', () => {
      const r = resolveWindow({ kind: 'range', from: '2020-01-01', to: '2020-01-05' }, '2026-09-24', ROWS_26_29)
      expect(r.notice).toBe(
        "The working-day calendar covers 1 April 2025 to 31 March 2029, so this shows this month."
      )
    })
  })
})

describe('windowHref', () => {
  it('month has no query parameter', () => {
    expect(windowHref('/kpis/people/1', { kind: 'month' })).toBe('/kpis/people/1')
  })

  it('the simple kinds', () => {
    expect(windowHref('/base', { kind: 'today' })).toBe('/base?window=today')
    expect(windowHref('/base', { kind: 'week' })).toBe('/base?window=week')
    expect(windowHref('/base', { kind: 'quarter' })).toBe('/base?window=quarter')
    expect(windowHref('/base', { kind: 'fy' })).toBe('/base?window=fy')
  })

  it('m, q, fyx and range', () => {
    expect(windowHref('/base', { kind: 'm', month: '2026-10-01' })).toBe('/base?window=m-2026-10')
    expect(windowHref('/base', { kind: 'q', fy: 2026, quarter: 3 })).toBe('/base?window=q-2026-3')
    expect(windowHref('/base', { kind: 'fyx', fy: 2026 })).toBe('/base?window=fy-2026')
    expect(windowHref('/base', { kind: 'range', from: '2026-03-02', to: '2026-03-08' })).toBe(
      '/base?window=range&from=2026-03-02&to=2026-03-08'
    )
  })
})

describe('windowOptions', () => {
  const opts = windowOptions('2026-10-08', ROWS_26_29, '/kpis/people/1')

  it('fyLabel and periods', () => {
    expect(opts.fyLabel).toBe('FY27')
    expect(opts.periods).toHaveLength(5)
    expect(opts.periods[0]).toEqual({ key: 'today', label: 'Today', href: '/kpis/people/1?window=today' })
    expect(opts.periods.map(p => p.key)).toEqual(['today', 'week', 'month', 'quarter', 'fy'])
  })

  it('12 month chips, April to March, not-started months have no href', () => {
    expect(opts.months).toHaveLength(12)
    expect(opts.months[0]).toEqual({
      key: 'm-2026-04',
      short: 'Apr',
      hiddenYear: ' 2026',
      href: '/kpis/people/1?window=m-2026-04',
    })
    const nov = opts.months.find(m => m.key === 'm-2026-11')
    expect(nov.href).toBeNull()
    const oct = opts.months.find(m => m.key === 'm-2026-10')
    expect(oct.href).toBe('/kpis/people/1?window=m-2026-10')
  })

  it('4 quarter chips, not-started quarters have no href', () => {
    expect(opts.quarters).toHaveLength(4)
    expect(opts.quarters[0]).toEqual({
      key: 'q-2027-1',
      short: 'Q1',
      hidden: ' FY27',
      href: '/kpis/people/1?window=q-2027-1',
    })
    const q3 = opts.quarters.find(q => q.key === 'q-2027-3')
    expect(q3.href).toBe('/kpis/people/1?window=q-2027-3')
    const q4 = opts.quarters.find(q => q.key === 'q-2027-4')
    expect(q4.href).toBeNull()
  })

  it('calendarStart and calendarEnd span the full rows', () => {
    expect(opts.calendarStart).toBe('2025-04-01')
    expect(opts.calendarEnd).toBe('2029-03-31')
  })
})
