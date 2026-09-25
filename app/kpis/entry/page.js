import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/kpi/library'
import { isIsoDate, addDays, monthStartOf, monthEndOf, eachDate, todayInAuckland } from '@/lib/kpi/calendar'
import { formatDayMonthYear } from '@/lib/kpi/format'
import { weekStartOf, windowOptions } from '@/lib/kpi/window'
import { buildEntryGrid } from '@/lib/kpi/entry'
import EntryGrid from './EntryGrid'
import styles from '../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Enter actuals | Spoke Sales Dashboard' }

function ErrorState() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>My entry</p>
      <h1 className={styles.pageTitle}>Enter actuals</h1>
      <p className={styles.errorState} role="alert">
        We couldn&apos;t load your entries. Refresh the page to try again.
      </p>
    </main>
  )
}

function joinLabels(list) {
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}

export default async function EntryPage({ searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const [meRes, entryPeopleRes, quarterMonthsRes] = await Promise.all([
    supabase.rpc('kpi_my_person_id'),
    supabase.rpc('kpi_entry_people'),
    supabase.rpc('kpi_quarter_months'),
  ])

  if (meRes.error || entryPeopleRes.error || quarterMonthsRes.error) {
    console.error('Entry page query error', meRes.error, entryPeopleRes.error, quarterMonthsRes.error)
    return <ErrorState />
  }

  const me = meRes.data

  if (me === null) {
    return (
      <main className={styles.main}>
        <p className={styles.eyebrow}>My entry</p>
        <h1 className={styles.pageTitle}>Enter actuals</h1>
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>
            Your login isn&apos;t linked to a person yet, so you can&apos;t enter actuals. Ask the
            admin to add your email on People and teams.
          </p>
        </div>
      </main>
    )
  }

  const entryPeopleIds = entryPeopleRes.data ?? []
  const quarterMonthRows = quarterMonthsRes.data ?? []
  const today = todayInAuckland()

  const rawPerson = searchParams?.person
  let personId = me
  let personNote = null
  if (typeof rawPerson === 'string' && isUuid(rawPerson) && entryPeopleIds.includes(rawPerson)) {
    personId = rawPerson
  } else if (rawPerson !== undefined) {
    personNote = "You can't enter actuals for that person, so this shows your own."
  }

  const { calendarStart, calendarEnd } = windowOptions(today, quarterMonthRows, '')

  const rawWeek = searchParams?.week
  let week
  let weekNote = null
  if (
    typeof rawWeek === 'string' &&
    isIsoDate(rawWeek) &&
    weekStartOf(rawWeek) === rawWeek &&
    rawWeek >= calendarStart &&
    rawWeek <= calendarEnd
  ) {
    week = rawWeek
  } else {
    week = weekStartOf(today)
    if (rawWeek !== undefined) weekNote = "That week link isn't valid, so this shows this week."
  }
  const weekEnd = addDays(week, 6)

  const personIdsToLoad = [...new Set([...entryPeopleIds, personId])]
  const personsRes = personIdsToLoad.length > 0
    ? await supabase.from('kpi_person').select('id, full_name, active, scorecard_type').in('id', personIdsToLoad).order('full_name')
    : { data: [], error: null }

  if (personsRes.error) {
    console.error('Entry page query error', personsRes.error)
    return <ErrorState />
  }

  const persons = personsRes.data ?? []
  const personById = new Map(persons.map(p => [p.id, p]))
  const person = personById.get(personId)

  const cellsRes = await supabase.rpc('kpi_entry_cells', { p_person_id: personId, p_from: week, p_to: weekEnd })
  if (cellsRes.error) {
    console.error('Entry page query error', cellsRes.error)
    return <ErrorState />
  }
  const cells = cellsRes.data ?? []
  const kpiIds = [...new Set(cells.map(c => c.kpi_definition_id))]

  const monthsTouched = [...new Set([monthStartOf(week), monthStartOf(weekEnd)])].sort()
  const calStart = monthsTouched[0]
  const calEnd = monthEndOf(monthsTouched[monthsTouched.length - 1])

  const [entriesRes, actualsRes, targetsRes, definitionRes, calendarRes, scorecardRes] = await Promise.all([
    supabase
      .from('kpi_manual_entry')
      .select('kpi_definition_id, date, value, numerator, denominator')
      .eq('person_id', personId)
      .gte('date', week)
      .lte('date', weekEnd),
    supabase
      .from('kpi_actual_daily')
      .select('kpi_definition_id, date, value, numerator, denominator')
      .eq('person_id', personId)
      .gte('date', week)
      .lte('date', weekEnd),
    supabase.rpc('kpi_window_targets', { p_person_id: personId, p_start: week, p_end: weekEnd }),
    kpiIds.length > 0
      ? supabase
          .from('kpi_definition')
          .select('id, version, name, kpi_type, unit, direction, aggregation, phasing, source')
          .in('id', kpiIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('kpi_calendar_day').select('date, is_working_day').gte('date', calStart).lte('date', calEnd).order('date'),
    supabase.from('kpi_scorecard').select('id, fy, quarter, status').eq('person_id', personId),
  ])

  if (
    entriesRes.error ||
    actualsRes.error ||
    targetsRes.error ||
    definitionRes.error ||
    calendarRes.error ||
    scorecardRes.error
  ) {
    console.error(
      'Entry page query error',
      entriesRes.error,
      actualsRes.error,
      targetsRes.error,
      definitionRes.error,
      calendarRes.error,
      scorecardRes.error
    )
    return <ErrorState />
  }

  const calendarRows = calendarRes.data ?? []
  const expectedDates = eachDate(calStart, calEnd)
  if (calendarRows.length !== expectedDates.length) {
    console.error('Entry page calendar row count mismatch', calendarRows.length, expectedDates.length)
    return <ErrorState />
  }

  const scorecards = scorecardRes.data ?? []

  const grid = buildEntryGrid({
    weekStart: week,
    today,
    cells,
    entries: entriesRes.data ?? [],
    definitions: definitionRes.data ?? [],
    targetRows: targetsRes.data ?? [],
    calendar: calendarRows,
    actuals: actualsRes.data ?? [],
    quarterMonthRows,
  })

  const personName = person ? person.full_name : 'This person'

  const weekQuarterRow = quarterMonthRows.find(r => r.month === monthStartOf(week))
  const hasScorecardForWeek = weekQuarterRow
    ? scorecards.some(s => s.fy === weekQuarterRow.fy && s.quarter === weekQuarterRow.quarter)
    : false

  const prevHref = `/kpis/entry?person=${personId}&week=${addDays(week, -7)}`
  const thisWeekStart = weekStartOf(today)
  const nextWeekStart = addDays(week, 7)
  const nextHref = nextWeekStart > today ? null : `/kpis/entry?person=${personId}&week=${nextWeekStart}`
  const thisHref = `/kpis/entry?person=${personId}&week=${thisWeekStart}`

  const unapprovedNote = grid.unapprovedQuarterLabels.length > 0
    ? `The ${joinLabels(grid.unapprovedQuarterLabels)} scorecard isn't approved yet. You can enter actuals now, and they're judged once it's locked.`
    : null

  const missingSummary =
    grid.missingCount === 0
      ? 'Nothing missing this week.'
      : grid.missingCount === 1
        ? '1 entry missing this week.'
        : `${grid.missingCount} entries missing this week.`

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>My entry</p>
      <h1 className={styles.pageTitle}>Enter actuals</h1>
      <p className={styles.lede}>
        Enter each day&apos;s figure for manual KPIs. You can change a day for 7 days after it.
        After that, only your line manager or the admin can.
      </p>

      {personNote && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{personNote}</p>
        </div>
      )}
      {weekNote && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{weekNote}</p>
        </div>
      )}

      {entryPeopleIds.length > 1 && (
        <form className={styles.quarterForm} method="get">
          <div className={styles.field}>
            <label htmlFor="entry-person">Entering for</label>
            <select id="entry-person" name="person" className={styles.select} defaultValue={personId}>
              {persons
                .filter(p => entryPeopleIds.includes(p.id))
                .map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          <button type="submit" className={styles.btnSecondary}>Show person</button>
        </form>
      )}

      <h2 className={styles.sectionTitle}>Week of {formatDayMonthYear(week)}</h2>

      {unapprovedNote && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{unapprovedNote}</p>
        </div>
      )}

      {cells.length === 0 ? (
        <p className={styles.emptyState}>
          {hasScorecardForWeek ? (
            'There are no manual KPIs on the scorecard for this week. KPIs from HubSpot, Xero, and forecast.spoke.nz fill in by themselves once they’re connected.'
          ) : (
            <>
              {personName} has no scorecard covering this week yet.{' '}
              <Link href="/kpis/scorecards">Start one on Scorecards.</Link>
            </>
          )}
        </p>
      ) : (
        <>
          {grid.closedBefore && (
            <p className={styles.helper}>
              Days before {grid.closedBefore} can only be changed by your line manager or the admin.
            </p>
          )}
          <p className={styles.helper}>{missingSummary}</p>

          <EntryGrid
            personId={personId}
            weekStart={week}
            days={grid.days}
            rows={grid.rows}
            prevHref={prevHref}
            thisHref={thisHref}
            isThisWeek={week === thisWeekStart}
            nextHref={nextHref}
          />

          <p className={styles.helper}>
            <Link href={`/kpis/people/${personId}?window=range&from=${week}&to=${weekEnd}`}>
              See this week on {personName}&apos;s scorecard
            </Link>
          </p>
        </>
      )}

      <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
    </main>
  )
}
