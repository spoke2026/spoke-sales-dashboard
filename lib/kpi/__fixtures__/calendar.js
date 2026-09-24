// TEST-ONLY helper. Not used by app code: in the app, working-day truth comes
// only from kpi_calendar_day rows produced by public.kpi_calendar_recompute().
//
// buildCalendar(start, end, holidayDates) → rows { date, is_working_day } with
// weekdays worked out in UTC. A date in holidayDates is non-working.

export function buildCalendar(start, end, holidayDates = []) {
  const holidays = new Set(holidayDates)
  const rows = []
  const [ys, ms, ds] = start.split('-').map(Number)
  const [ye, me, de] = end.split('-').map(Number)
  const last = Date.UTC(ye, me - 1, de)
  for (let t = Date.UTC(ys, ms - 1, ds); t <= last; t += 86400000) {
    const d = new Date(t)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    const dow = d.getUTCDay()
    rows.push({ date, is_working_day: dow !== 0 && dow !== 6 && !holidays.has(date) })
  }
  return rows
}
