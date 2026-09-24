import { describe, it, expect } from 'vitest'
import {
  KpiEngineError,
  isIsoDate,
  addDays,
  monthStartOf,
  monthEndOf,
  daysInMonth,
  eachDate,
  todayInAuckland,
  indexCalendar,
  countTargetDays,
} from './calendar.js'
import { buildCalendar } from './__fixtures__/calendar.js'

const JUL_SEP_2026 = buildCalendar('2026-07-01', '2026-09-30', ['2026-07-10'])

function codeOf(fn) {
  try {
    fn()
  } catch (e) {
    expect(e).toBeInstanceOf(KpiEngineError)
    return e.code
  }
  return 'NO_THROW'
}

describe('KpiEngineError', () => {
  it('carries a code and a message', () => {
    const e = new KpiEngineError('INVALID_INPUT', 'bad')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('INVALID_INPUT')
    expect(e.message).toBe('bad')
    expect(e.name).toBe('KpiEngineError')
  })
})

describe('isIsoDate', () => {
  it('accepts real dates, including 2028-02-29', () => {
    expect(isIsoDate('2026-09-24')).toBe(true)
    expect(isIsoDate('2028-02-29')).toBe(true)
  })
  it('rejects dates that do not round-trip, such as 2026-02-30 and 2027-02-29', () => {
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('2026-13-01')).toBe(false)
  })
  it('rejects the wrong shape and non-strings', () => {
    expect(isIsoDate('2026-9-24')).toBe(false)
    expect(isIsoDate('2026-09-24T00:00:00Z')).toBe(false)
    expect(isIsoDate(20260924)).toBe(false)
    expect(isIsoDate(null)).toBe(false)
    expect(isIsoDate(undefined)).toBe(false)
  })
})

describe('date helpers', () => {
  it('addDays crosses month, year and the NZ daylight-saving change', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-09-26', 1)).toBe('2026-09-27')
    expect(addDays('2026-09-27', 1)).toBe('2026-09-28')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('monthStartOf, monthEndOf and daysInMonth', () => {
    expect(monthStartOf('2026-09-24')).toBe('2026-09-01')
    expect(monthEndOf('2026-09-24')).toBe('2026-09-30')
    expect(monthEndOf('2028-02-10')).toBe('2028-02-29')
    expect(monthEndOf('2026-12-05')).toBe('2026-12-31')
    expect(daysInMonth('2026-09-01')).toBe(30)
    expect(daysInMonth('2027-02-01')).toBe(28)
    expect(daysInMonth('2028-02-01')).toBe(29)
  })
  it('eachDate is inclusive and empty when start > end', () => {
    expect(eachDate('2026-09-29', '2026-10-01')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01'])
    expect(eachDate('2026-09-24', '2026-09-24')).toEqual(['2026-09-24'])
    expect(eachDate('2026-09-25', '2026-09-24')).toEqual([])
  })
})

describe('todayInAuckland', () => {
  it('switches date at NZ midnight under NZST (+12)', () => {
    expect(todayInAuckland(new Date('2026-09-23T11:59:59Z'))).toBe('2026-09-23')
    expect(todayInAuckland(new Date('2026-09-23T12:00:00Z'))).toBe('2026-09-24')
  })
  it('handles the NZDT start on 27 Sep 2026', () => {
    expect(todayInAuckland(new Date('2026-09-26T13:59:59Z'))).toBe('2026-09-27')
    expect(todayInAuckland(new Date('2026-09-26T14:00:00Z'))).toBe('2026-09-27')
  })
  it('derives 24 Sep 2026 from the brief instant', () => {
    expect(todayInAuckland(new Date('2026-09-23T14:00:00Z'))).toBe('2026-09-24')
  })
  it('defaults to now and returns an ISO date', () => {
    expect(isIsoDate(todayInAuckland())).toBe(true)
  })
})

describe('indexCalendar', () => {
  it('maps date to the working-day flag', () => {
    const map = indexCalendar(JUL_SEP_2026)
    expect(map.get('2026-07-10')).toBe(false)
    expect(map.get('2026-09-24')).toBe(true)
    expect(map.size).toBe(92)
  })
  it('throws INVALID_CALENDAR when it is not an array', () => {
    expect(codeOf(() => indexCalendar(null))).toBe('INVALID_CALENDAR')
  })
  it('throws INVALID_CALENDAR for a row that is null or not an object', () => {
    expect(codeOf(() => indexCalendar([null]))).toBe('INVALID_CALENDAR')
    expect(codeOf(() => indexCalendar(['2026-09-01']))).toBe('INVALID_CALENDAR')
  })
  it('throws INVALID_CALENDAR for a bad date', () => {
    expect(codeOf(() => indexCalendar([{ date: '2026-02-30', is_working_day: true }]))).toBe('INVALID_CALENDAR')
  })
  it('throws INVALID_CALENDAR for a truthy or falsy flag that is not exactly true or false', () => {
    expect(codeOf(() => indexCalendar([{ date: '2026-09-01', is_working_day: 1 }]))).toBe('INVALID_CALENDAR')
    expect(codeOf(() => indexCalendar([{ date: '2026-09-01', is_working_day: 0 }]))).toBe('INVALID_CALENDAR')
    expect(codeOf(() => indexCalendar([{ date: '2026-09-01', is_working_day: null }]))).toBe('INVALID_CALENDAR')
    expect(codeOf(() => indexCalendar([{ date: '2026-09-01', is_working_day: 'true' }]))).toBe('INVALID_CALENDAR')
  })
  it('throws INVALID_CALENDAR for a repeated date', () => {
    const rows = [
      { date: '2026-09-01', is_working_day: true },
      { date: '2026-09-01', is_working_day: false },
    ]
    expect(codeOf(() => indexCalendar(rows))).toBe('INVALID_CALENDAR')
  })
})

describe('countTargetDays', () => {
  const wd = (start, end, calendar = JUL_SEP_2026) => countTargetDays({ calendar, phasing: 'working_days', start, end })

  it('September 2026 has 22 working days, 18 from 1 to 24 Sep', () => {
    expect(wd('2026-09-01', '2026-09-30')).toBe(22)
    expect(wd('2026-09-01', '2026-09-24')).toBe(18)
  })
  it('August 2026 has 21 and July 2026 with Matariki has 22', () => {
    expect(wd('2026-08-01', '2026-08-31')).toBe(21)
    expect(wd('2026-07-01', '2026-07-31')).toBe(22)
  })
  it('accepts a Map from indexCalendar', () => {
    expect(wd('2026-09-01', '2026-09-30', indexCalendar(JUL_SEP_2026))).toBe(22)
  })
  it('counts every date for calendar_days and ignores the calendar', () => {
    expect(countTargetDays({ calendar: undefined, phasing: 'calendar_days', start: '2026-09-01', end: '2026-09-24' })).toBe(24)
    expect(countTargetDays({ calendar: [], phasing: 'calendar_days', start: '2026-09-26', end: '2026-09-28' })).toBe(3)
  })
  it('returns 0 when start > end, for both phasings', () => {
    expect(wd('2026-09-25', '2026-09-24')).toBe(0)
    expect(countTargetDays({ calendar: [], phasing: 'calendar_days', start: '2026-09-25', end: '2026-09-24' })).toBe(0)
  })
  it('throws CALENDAR_GAP when a date is missing from the calendar', () => {
    expect(codeOf(() => wd('2026-09-15', '2026-10-02'))).toBe('CALENDAR_GAP')
  })
  it('throws INVALID_INPUT for an unknown phasing', () => {
    expect(codeOf(() => countTargetDays({ calendar: JUL_SEP_2026, phasing: 'weekdays', start: '2026-09-01', end: '2026-09-30' }))).toBe('INVALID_INPUT')
  })
  it('throws INVALID_INPUT for a bad start or end', () => {
    expect(codeOf(() => wd('2026-09-31', '2026-09-30'))).toBe('INVALID_INPUT')
    expect(codeOf(() => wd('2026-09-01', 'banana'))).toBe('INVALID_INPUT')
  })
  it('throws INVALID_CALENDAR when the calendar rows are bad', () => {
    expect(codeOf(() => wd('2026-09-01', '2026-09-30', 'not rows'))).toBe('INVALID_CALENDAR')
  })
})
