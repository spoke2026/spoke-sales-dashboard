import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { todayInAuckland } from '@/lib/kpi/calendar'
import { formatTimestampDate } from '@/lib/kpi/format'
import {
  quarterOptions,
  currentQuarter,
  parseQuarterParam,
  quarterParam,
  formatQuarter,
  statusLabel,
} from '@/lib/kpi/scorecard'
import StartScorecardButton from './StartScorecardButton'
import styles from '../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Scorecards | Spoke Sales Dashboard' }

const LIST_NOT_LINKED =
  "Your login isn't linked to a person yet, so you can view scorecards but not start or change one. Ask the admin to add your email on People and teams."

function ErrorState() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPIs</p>
      <h1 className={styles.pageTitle}>Scorecards</h1>
      <p className={styles.errorState} role="alert">
        We couldn&apos;t load the scorecards. Refresh the page to try again.
      </p>
    </main>
  )
}

export default async function ScorecardsPage({ searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const [quarterRes, meRes] = await Promise.all([
    supabase.rpc('kpi_quarter_months'),
    supabase.rpc('kpi_my_person_id'),
  ])

  if (quarterRes.error || meRes.error) {
    console.error('Scorecards page query error', quarterRes.error, meRes.error)
    return <ErrorState />
  }

  const options = quarterOptions(quarterRes.data ?? [], todayInAuckland())
  const requested = typeof searchParams?.quarter === 'string' ? parseQuarterParam(searchParams.quarter) : null
  const chosen = requested !== null ? options.find(o => o.fy === requested.fy && o.quarter === requested.quarter) : undefined
  const quarter = chosen ?? currentQuarter(options)

  const me = meRes.data

  if (quarter === null) {
    return <ErrorState />
  }

  const [personRes, scorecardRes] = await Promise.all([
    supabase.from('kpi_person').select('id, full_name, manager_id, scorecard_type, active'),
    supabase.from('kpi_scorecard').select('*').eq('fy', quarter.fy).eq('quarter', quarter.quarter),
  ])

  if (personRes.error || scorecardRes.error) {
    console.error('Scorecards page query error', personRes.error, scorecardRes.error)
    return <ErrorState />
  }

  const people = personRes.data ?? []
  const scorecards = scorecardRes.data ?? []
  const scorecardIds = scorecards.map(s => s.id)

  const { data: assignmentRows, error: assignmentError } = scorecardIds.length > 0
    ? await supabase.from('kpi_assignment').select('id, scorecard_id').in('scorecard_id', scorecardIds)
    : { data: [], error: null }

  if (assignmentError) {
    console.error('Scorecards page query error', assignmentError)
    return <ErrorState />
  }

  const companyScorecard = scorecards.find(s => s.person_id === null) ?? null
  const activeIndividuals = people
    .filter(p => p.active === true && p.scorecard_type !== 'company_only')
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
  const activeCompanyOnly = people.filter(p => p.active === true && p.scorecard_type === 'company_only')

  const scorecardByPersonId = new Map(scorecards.filter(s => s.person_id !== null).map(s => [s.person_id, s]))

  const inactiveWithScorecard = people.filter(p => p.active === false && scorecardByPersonId.has(p.id))

  const rowsPeople = [...activeIndividuals, ...inactiveWithScorecard].sort((a, b) =>
    a.full_name.localeCompare(b.full_name)
  )

  const assignmentCountByScorecard = new Map()
  for (const a of assignmentRows ?? []) {
    assignmentCountByScorecard.set(a.scorecard_id, (assignmentCountByScorecard.get(a.scorecard_id) ?? 0) + 1)
  }

  const personNameById = new Map(people.map(p => [p.id, p.full_name]))

  const canCreateIds = [null, ...rowsPeople.map(p => p.id)]
  const canCreateResults = await Promise.all(
    canCreateIds.map(id => supabase.rpc('kpi_can_create_scorecard', { p_person_id: id }))
  )
  if (canCreateResults.some(r => r.error)) {
    console.error('Scorecards page query error', canCreateResults.find(r => r.error).error)
    return <ErrorState />
  }
  const canCreateById = new Map(canCreateIds.map((id, i) => [id, canCreateResults[i].data === true]))

  const quarterLabel = formatQuarter(quarter.fy, quarter.quarter)

  function approvedText(scorecard) {
    if (scorecard.approved_at === null || scorecard.approved_at === undefined) return 'Not yet'
    const prefix = scorecard.approval_kind === 'board' ? 'Board, ' : ''
    return `${prefix}${formatTimestampDate(scorecard.approved_at)}`
  }

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPIs</p>
      <h1 className={styles.pageTitle}>Scorecards</h1>
      <p className={styles.lede}>
        Everyone can see every scorecard. Staff draft their own, line managers approve them, and
        the board approves the company scorecard.
      </p>

      {me === null && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{LIST_NOT_LINKED}</p>
        </div>
      )}

      <form className={styles.quarterForm} method="GET">
        <div className={styles.field}>
          <label htmlFor="quarter">Quarter</label>
          <select id="quarter" name="quarter" className={styles.select} defaultValue={quarter.param}>
            {options.map(o => (
              <option key={o.param} value={o.param}>{o.label}</option>
            ))}
          </select>
        </div>
        <button type="submit" className={styles.btnSecondary}>Show quarter</button>
      </form>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Company scorecard</h2>
        </div>
        {companyScorecard !== null ? (
          <p>
            {statusLabel(companyScorecard.status)}.{' '}
            <span className={styles.mono}>
              {assignmentCountByScorecard.get(companyScorecard.id) ?? 0}
            </span>{' '}
            {(assignmentCountByScorecard.get(companyScorecard.id) ?? 0) === 1 ? 'KPI.' : 'KPIs.'}
            {' '}
            <Link href={`/kpis/scorecards/${companyScorecard.id}`}>Open company scorecard</Link>
          </p>
        ) : (
          <>
            <p>No company scorecard for {quarterLabel} yet.</p>
            {canCreateById.get(null) && !quarter.isPast && (
              <StartScorecardButton
                personId={null}
                fy={quarter.fy}
                quarter={quarter.quarter}
                label="Start company scorecard"
              />
            )}
          </>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>People</h2>
        </div>
        {quarter.isPast && (
          <p className={styles.helper}>
            This quarter has ended. Scorecards can only be started for this quarter or a later one.
          </p>
        )}
        {activeCompanyOnly.length > 0 && (
          <p className={styles.helper}>
            People set to Company only aren&apos;t listed. Their KPIs sit on the company scorecard.
          </p>
        )}
        {rowsPeople.length === 0 ? (
          <p className={styles.emptyState}>
            No people set up yet. The admin adds people on People and teams.
          </p>
        ) : (
          <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="People's scorecards table">
            <table className={styles.table}>
              <caption className={styles.visuallyHidden}>People&apos;s scorecards for {quarterLabel}</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Line manager</th>
                  <th scope="col">Status</th>
                  <th scope="col">KPIs</th>
                  <th scope="col">Approved</th>
                  <th scope="col">Scorecard</th>
                </tr>
              </thead>
              <tbody>
                {rowsPeople.map(person => {
                  const scorecard = scorecardByPersonId.get(person.id) ?? null
                  const displayName = person.active === false ? `${person.full_name} (inactive)` : person.full_name
                  const count = scorecard === null ? 0 : assignmentCountByScorecard.get(scorecard.id) ?? 0
                  const canCreate = canCreateById.get(person.id) === true
                  return (
                    <tr key={person.id}>
                      <td>{displayName}</td>
                      <td>{personNameById.get(person.manager_id) ?? 'Not set'}</td>
                      <td>{scorecard === null ? 'Not started' : statusLabel(scorecard.status)}</td>
                      <td className={styles.mono}>{count}</td>
                      <td>{scorecard === null ? 'Not yet' : approvedText(scorecard)}</td>
                      <td>
                        {scorecard !== null ? (
                          <Link href={`/kpis/scorecards/${scorecard.id}`}>
                            Open<span className={styles.visuallyHidden}> scorecard for {person.full_name}</span>
                          </Link>
                        ) : canCreate && !quarter.isPast ? (
                          <StartScorecardButton
                            personId={person.id}
                            fy={quarter.fy}
                            quarter={quarter.quarter}
                            label="Start scorecard"
                            hiddenSuffix={` for ${person.full_name}`}
                          />
                        ) : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
    </main>
  )
}
