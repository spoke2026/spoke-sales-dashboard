import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  todayInAuckland,
  monthStartOf,
  monthEndOf,
  countTargetDays,
  KpiEngineError,
} from '@/lib/kpi/calendar'
import { formatDayMonth, formatMonthYear, isWeekend } from '@/lib/kpi/format'
import styles from './kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'KPIs | Spoke Sales Dashboard' }

const MONTH_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/

export default async function KpisPage({ searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: isAdminData, error: adminError } = await supabase.rpc('is_admin')
  const isAdmin = !adminError && isAdminData === true

  const rawMonth = searchParams?.month
  const monthStart = typeof rawMonth === 'string' && MONTH_PARAM.test(rawMonth)
    ? `${rawMonth}-01`
    : monthStartOf(todayInAuckland())
  const monthEnd = monthEndOf(monthStart)
  const monthLabel = formatMonthYear(monthStart)

  const [personRes, teamRes, calendarRes] = await Promise.all([
    supabase
      .from('kpi_person')
      .select('id, full_name, is_contractor, scorecard_type, primary_team_id, manager_id, active')
      .order('full_name'),
    supabase.from('kpi_team').select('id, name, active').order('name'),
    supabase
      .from('kpi_calendar_day')
      .select('date, is_working_day, holiday_name')
      .gte('date', monthStart)
      .lte('date', monthEnd)
      .order('date'),
  ])

  let queryError = false
  if (personRes.error || teamRes.error || calendarRes.error) {
    console.error(
      'KPIs page query error',
      personRes.error,
      teamRes.error,
      calendarRes.error
    )
    queryError = true
  }

  const calendarRows = calendarRes.data ?? []

  let workingDays = null
  let passedDays = null
  let calendarGapMessage = null

  if (!queryError) {
    try {
      const today = todayInAuckland()
      const passedEnd = today < monthEnd ? today : monthEnd
      workingDays = countTargetDays({ calendar: calendarRows, phasing: 'working_days', start: monthStart, end: monthEnd })
      passedDays = countTargetDays({ calendar: calendarRows, phasing: 'working_days', start: monthStart, end: passedEnd })
    } catch (err) {
      if (err instanceof KpiEngineError && err.code === 'CALENDAR_GAP') {
        calendarGapMessage = `The working-day calendar doesn't cover ${monthLabel} yet.`
      } else {
        console.error('KPIs page calendar error', err)
        queryError = true
      }
    }
  }

  const teams = teamRes.data ?? []
  const people = personRes.data ?? []
  const teamNameById = new Map(teams.map(t => [t.id, t.name]))
  const personNameById = new Map(people.map(p => [p.id, p.full_name]))

  const activePeople = people.filter(p => p.active === true)
  const activeTeams = teams.filter(t => t.active === true)
  const activePeopleCountByTeam = new Map()
  for (const person of activePeople) {
    if (person.primary_team_id === null) continue
    activePeopleCountByTeam.set(
      person.primary_team_id,
      (activePeopleCountByTeam.get(person.primary_team_id) ?? 0) + 1
    )
  }

  const holidayEntries = calendarRows
    .filter(row => row.is_working_day === false && row.holiday_name !== null && !isWeekend(row.date))
    .map(row => `${row.holiday_name}, ${formatDayMonth(row.date)}`)

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPIs</p>
      <h1 className={styles.pageTitle}>KPI scorecard</h1>
      <p className={styles.lede}>
        Every KPI will be judged red or green against its target. Scorecards and targets come
        next. First, set up who is scored and the working-day calendar.
      </p>
      {isAdmin && (
        <Link href="/kpis/admin" className={styles.manageLink}>
          Manage people and teams
        </Link>
      )}

      {queryError ? (
        <p className={styles.errorState} role="alert">
          We couldn&apos;t load the KPI setup. Refresh the page to try again.
        </p>
      ) : (
        <>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.sectionTitle}>{monthLabel}</h2>
            </div>
            {calendarGapMessage ? (
              <p className={styles.emptyState}>{calendarGapMessage}</p>
            ) : (
              <>
                <div className={styles.statsRow}>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{workingDays}</span>
                    <span className={styles.statLabel}>Working days</span>
                  </div>
                  <div className={styles.stat}>
                    <span className={styles.statValue}>{passedDays}</span>
                    <span className={styles.statLabel}>Passed, including today</span>
                  </div>
                </div>
                <p className={styles.holidays}>
                  Public holidays and closures:{' '}
                  {holidayEntries.length > 0
                    ? holidayEntries.join(', ')
                    : 'No public holidays or closures this month.'}
                </p>
              </>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.sectionTitle}>People</h2>
            </div>
            {activePeople.length === 0 ? (
              <p className={styles.emptyState}>
                No people set up yet. The admin adds people and teams.
              </p>
            ) : (
              <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="People table">
                <table className={styles.table}>
                  <caption className={styles.visuallyHidden}>People</caption>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Team</th>
                      <th scope="col">Line manager</th>
                      <th scope="col">Type</th>
                      <th scope="col">Scorecard</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePeople.map(person => (
                      <tr key={person.id}>
                        <td>{person.full_name}</td>
                        <td>{teamNameById.get(person.primary_team_id) ?? 'Not set'}</td>
                        <td>{personNameById.get(person.manager_id) ?? 'Not set'}</td>
                        <td>{person.is_contractor === true ? 'Contractor' : 'Internal'}</td>
                        <td>{person.scorecard_type === 'company_only' ? 'Company only' : 'Individual'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.sectionTitle}>Teams</h2>
            </div>
            {activeTeams.length === 0 ? (
              <p className={styles.emptyState}>No teams set up yet.</p>
            ) : (
              <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Teams table">
                <table className={styles.table}>
                  <caption className={styles.visuallyHidden}>Teams</caption>
                  <thead>
                    <tr>
                      <th scope="col">Team</th>
                      <th scope="col">People</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTeams.map(team => (
                      <tr key={team.id}>
                        <td>{team.name}</td>
                        <td>{activePeopleCountByTeam.get(team.id) ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  )
}
