import { describe, it, expect, afterEach } from 'vitest'
import { formatDayMonth, formatDayMonthYear, formatLongDate, formatMonthYear, isWeekend } from './format.js'

const ORIGINAL_TZ = process.env.TZ
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('format', () => {
  it('formats the brief strings exactly', () => {
    expect(formatDayMonth('2026-07-10')).toBe('Fri 10 Jul')
    expect(formatDayMonth('2028-11-15')).toBe('Wed 15 Nov')
    expect(formatDayMonth('2026-10-26')).toBe('Mon 26 Oct')
    expect(formatDayMonthYear('2026-12-28')).toBe('Mon 28 Dec 2026')
    expect(formatLongDate('2025-04-01')).toBe('1 April 2025')
    expect(formatLongDate('2029-03-31')).toBe('31 March 2029')
    expect(formatMonthYear('2026-09-01')).toBe('September 2026')
    expect(formatMonthYear('2031-01-01')).toBe('January 2031')
  })
  it('uses three-letter names, never "Sept" or "Tues"', () => {
    expect(formatDayMonth('2026-09-15')).toBe('Tue 15 Sep')
    expect(formatDayMonth('2026-09-24')).toBe('Thu 24 Sep')
  })
  it('isWeekend', () => {
    expect(isWeekend('2028-11-18')).toBe(true)
    expect(isWeekend('2028-11-19')).toBe(true)
    expect(isWeekend('2028-11-17')).toBe(false)
  })
  it('gives the same labels in a UTC-minus time zone', () => {
    process.env.TZ = 'America/Los_Angeles'
    expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).not.toBe(0)
    expect(formatDayMonth('2026-07-10')).toBe('Fri 10 Jul')
    expect(formatLongDate('2025-04-01')).toBe('1 April 2025')
    expect(isWeekend('2028-11-18')).toBe(true)
  })
})
