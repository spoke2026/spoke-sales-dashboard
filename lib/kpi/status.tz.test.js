import { describe, it, expect, afterEach } from 'vitest'
import { evaluateKpi } from './status.js'
import { todayInAuckland } from './calendar.js'
import { EXAMPLES, TODAY_INSTANT, CALENDAR } from './__fixtures__/examples.js'

// The engine must give identical results whatever the host time zone is
// (an NZ laptop, Vercel in UTC, or anywhere else).
const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles']) {
  describe(`TZ flip: ${zone}`, () => {
    it(`the eight 8.8 examples give identical results under ${zone}`, () => {
      process.env.TZ = zone
      // Proof the switch took effect, so this test cannot pass vacuously.
      expect(new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset()).not.toBe(0)

      const today = todayInAuckland(new Date(TODAY_INSTANT))
      expect(today).toBe('2026-09-24')
      expect(EXAMPLES).toHaveLength(8)
      for (const ex of EXAMPLES) {
        for (const input of ex.cases) {
          const result = evaluateKpi({ ...input, today, calendar: CALENDAR })
          for (const [key, value] of Object.entries(ex.expected)) {
            expect(result[key], `${zone} ${ex.name} ${key}`).toBe(value)
          }
        }
      }
    })
  })
}
