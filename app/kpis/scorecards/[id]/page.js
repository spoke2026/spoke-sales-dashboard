import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid, latestVersions, labelFor, formatExampleTarget, readStoredNumber, toDisplayNumber, savedByLabel } from '@/lib/kpi/library'
import { formatMonthYear, formatTimestampDate, formatDayMonthYear } from '@/lib/kpi/format'
import {
  formatQuarter,
  formatQuarterMonths,
  quarterParam,
  statusLabel,
  cellField,
  scorecardWarnings,
  isCompanyKpi,
  NOT_LINKED,
} from '@/lib/kpi/scorecard'
import ScorecardWorkspace from './ScorecardWorkspace'
import styles from '../../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Scorecard | Spoke Sales Dashboard' }

function NotFound() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Scorecards</p>
      <h1 className={styles.pageTitle}>Scorecard not found</h1>
      <p className={styles.lede}>
        That scorecard doesn&apos;t exist. It may have been a test entry that was removed.
      </p>
      <Link href="/kpis/scorecards" className={styles.backLink}>Back to scorecards</Link>
    </main>
  )
}

function ErrorState() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Scorecards</p>
      <h1 className={styles.pageTitle}>Scorecard</h1>
      <p className={styles.errorState} role="alert">
        We couldn&apos;t load this scorecard. Refresh the page to try again.
      </p>
    </main>
  )
}

export default async function ScorecardPage({ params, searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  if (!isUuid(params.id)) {
    return <NotFound />
  }

  const { data: scorecardRows, error: scorecardError } = await supabase
    .from('kpi_scorecard')
    .select('*')
    .eq('id', params.id)

  if (scorecardError) {
    console.error('Scorecard page query error', scorecardError)
    return <ErrorState />
  }
  if (scorecardRows.length === 0) {
    return <NotFound />
  }
  const scorecard = scorecardRows[0]

  const [
    personRes,
    assignmentRes,
    definitionRes,
    currentTargetsRes,
    quarterMonthsRes,
    actionsRes,
    meRes,
    missingRes,
  ] = await Promise.all([
    supabase.from('kpi_person').select('id, full_name, email, manager_id'),
    supabase.from('kpi_assignment').select('*').eq('scorecard_id', scorecard.id).order('sort_order'),
    supabase.from('kpi_definition').select('id, version, name, kpi_type, unit, status, attribution'),
    supabase.rpc('kpi_current_targets', { p_scorecard_id: scorecard.id }),
    supabase.rpc('kpi_quarter_months'),
    supabase.rpc('kpi_scorecard_actions', { p_scorecard_id: scorecard.id }),
    supabase.rpc('kpi_my_person_id'),
    supabase.rpc('kpi_scorecard_missing_targets', { p_scorecard_id: scorecard.id }),
  ])

  if (
    personRes.error ||
    assignmentRes.error ||
    definitionRes.error ||
    currentTargetsRes.error ||
    quarterMonthsRes.error ||
    actionsRes.error ||
    meRes.error ||
    missingRes.error
  ) {
    console.error(
      'Scorecard page query error',
      personRes.error,
      assignmentRes.error,
      definitionRes.error,
      currentTargetsRes.error,
      quarterMonthsRes.error,
      actionsRes.error,
      meRes.error,
      missingRes.error
    )
    return <ErrorState />
  }

  const people = personRes.data ?? []
  const assignments = assignmentRes.data ?? []
  const definitions = definitionRes.data ?? []
  const currentTargets = currentTargetsRes.data ?? []
  const quarterMonthRows = quarterMonthsRes.data ?? []
  const actions = actionsRes.data ?? []
  const me = meRes.data
  const missingTargets = missingRes.data ?? 0

  let history = []
  if (scorecard.status === 'locked') {
    const assignmentIds = assignments.map(a => a.id)
    if (assignmentIds.length > 0) {
      const { data: historyRows, error: historyError } = await supabase
        .from('kpi_target')
        .select('*')
        .in('assignment_id', assignmentIds)
        .gt('effective_from', scorecard.approved_at)
        .order('effective_from', { ascending: false })

      if (historyError) {
        console.error('Scorecard page query error', historyError)
        return <ErrorState />
      }
      history = historyRows ?? []
    }
  }

  const personNameById = new Map(people.map(p => [p.id, p.full_name]))
  const owner = scorecard.person_id === null ? null : people.find(p => p.id === scorecard.person_id) ?? null

  const months = [...new Set(quarterMonthRows.filter(r => r.fy === scorecard.fy && r.quarter === scorecard.quarter).map(r => r.month))].sort()
  const monthLabels = months.map(m => formatMonthYear(m))
  const quarterLabel = `${formatQuarter(scorecard.fy, scorecard.quarter)}, ${formatQuarterMonths(months)}`

  const latestDefinitions = latestVersions(definitions)
  const latestById = new Map(latestDefinitions.map(d => [d.id, d]))

  const currentByCell = new Map()
  for (const row of currentTargets) {
    currentByCell.set(cellField(row.assignment_id, row.month), row.value)
  }

  const rows = assignments.map(a => {
    const pinned = definitions.find(d => d.id === a.kpi_definition_id && d.version === a.kpi_version)
    const latest = latestById.get(a.kpi_definition_id)
    const unit = pinned ? pinned.unit : 'count'
    return {
      assignmentId: a.id,
      kpiId: a.kpi_definition_id,
      version: a.kpi_version,
      name: pinned ? pinned.name : 'Unknown KPI',
      kpiType: pinned ? pinned.kpi_type : 'lag',
      meta: pinned ? `${labelFor('kpiType', pinned.kpi_type)}, ${labelFor('unit', pinned.unit)}` : 'Unknown',
      retired: latest ? latest.status === 'retired' : false,
      newer: latest ? latest.version > a.kpi_version : false,
      cells: months.map(month => {
        const field = cellField(a.id, month)
        const stored = currentByCell.has(field) ? readStoredNumber(currentByCell.get(field)) : null
        return {
          field,
          initial: stored === null ? '' : String(toDisplayNumber(unit, stored)),
          display: formatExampleTarget(unit, stored),
        }
      }),
    }
  })

  const assignedKpiIds = new Set(assignments.map(a => a.kpi_definition_id))
  const isCompanyScorecard = scorecard.person_id === null
  const eligibleDefinitions = latestDefinitions.filter(
    d => d.status === 'published' && isCompanyKpi(d) === isCompanyScorecard
  )
  const hasPublishedKpis = eligibleDefinitions.length > 0
  const addOptions = eligibleDefinitions
    .filter(d => !assignedKpiIds.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(d => ({ id: d.id, kpiType: d.kpi_type, label: `${d.name} (${labelFor('unit', d.unit)})` }))

  const warnings = scorecardWarnings({ kpiTypes: rows.map(r => r.kpiType), missingTargets })

  const notice = searchParams?.notice === 'started'
    ? 'Scorecard started. Add KPIs from the library, then set a target for each month.'
    : null

  const approvedName = personNameById.get(scorecard.approved_by) ?? 'Not recorded'
  const submittedName = personNameById.get(scorecard.submitted_by) ?? 'Not recorded'
  const returnedName = personNameById.get(scorecard.returned_by) ?? 'Not recorded'

  return (
    <main className={styles.main}>
      {notice && <p className={styles.statusMsg} role="status">{notice}</p>}

      <p className={styles.eyebrow}>Scorecards</p>
      <h1 className={styles.pageTitle}>{owner ? owner.full_name : 'Company scorecard'}</h1>
      <div className={styles.statusLine}>
        <span className={styles.statusTag}>{statusLabel(scorecard.status)}</span>
        <span>{quarterLabel}</span>
      </div>

      {owner !== null && (
        <p className={styles.helper}>
          Line manager: {personNameById.get(owner.manager_id) ?? 'Not set'}.
        </p>
      )}
      {scorecard.status === 'submitted' && (
        <p className={styles.helper}>
          Submitted by {submittedName} on {formatTimestampDate(scorecard.submitted_at)}.
        </p>
      )}
      {scorecard.status === 'locked' && scorecard.approval_kind === 'standard' && (
        <p className={styles.helper}>
          Approved by {approvedName} on {formatTimestampDate(scorecard.approved_at)}.
        </p>
      )}
      {scorecard.status === 'locked' && scorecard.approval_kind === 'board' && (
        <p className={styles.helper}>
          Board approval recorded by {approvedName} on {formatTimestampDate(scorecard.approved_at)}. Board
          meeting {formatDayMonthYear(scorecard.board_meeting_date)}, reference: {scorecard.board_reference}.
        </p>
      )}

      {scorecard.status === 'draft' && scorecard.returned_at !== null && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>
            Returned by {returnedName} on {formatTimestampDate(scorecard.returned_at)}
            <br />
            {scorecard.return_note}
          </p>
        </div>
      )}

      {me === null && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{NOT_LINKED}</p>
        </div>
      )}

      {scorecard.status === 'locked' && actions.includes('exception_edit') && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>
            This scorecard is locked. You can change its targets as the admin. Each change needs a
            reason, and earlier targets stay in the history.
          </p>
        </div>
      )}
      {scorecard.status === 'locked' && !actions.includes('exception_edit') && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>
            This scorecard is locked for the quarter. Only the admin can change it, with a reason.
          </p>
        </div>
      )}

      {(scorecard.status === 'draft' || scorecard.status === 'submitted') && (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.sectionTitle}>Before approval</h2>
          </div>
          {warnings.length === 0 ? (
            <p>Ready for approval. Every KPI has a target for every month.</p>
          ) : (
            <ul className={styles.checksList}>
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>KPIs and monthly targets</h2>
        </div>
        <ScorecardWorkspace
          key={scorecard.id}
          scorecard={{ id: scorecard.id, status: scorecard.status, fy: scorecard.fy, quarter: scorecard.quarter }}
          quarterLabel={formatQuarter(scorecard.fy, scorecard.quarter)}
          actions={actions}
          months={months}
          monthLabels={monthLabels}
          rows={rows}
          addOptions={addOptions}
          hasPublishedKpis={hasPublishedKpis}
        />
      </section>

      {scorecard.status === 'locked' && (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.sectionTitle}>Changes since approval</h2>
          </div>
          {history.length === 0 ? (
            <p className={styles.emptyState}>No changes since approval.</p>
          ) : (
            <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Changes since approval table">
              <table className={styles.table}>
                <caption className={styles.visuallyHidden}>Changes since approval</caption>
                <thead>
                  <tr>
                    <th scope="col">KPI</th>
                    <th scope="col">Month</th>
                    <th scope="col">Target</th>
                    <th scope="col">Changed on</th>
                    <th scope="col">Changed by</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(row => {
                    const assignment = assignments.find(a => a.id === row.assignment_id)
                    const pinned = assignment ? definitions.find(d => d.id === assignment.kpi_definition_id && d.version === assignment.kpi_version) : null
                    const unit = pinned ? pinned.unit : 'count'
                    return (
                      <tr key={row.id}>
                        <td>{pinned ? pinned.name : 'Unknown KPI'}</td>
                        <td>{formatMonthYear(row.month)}</td>
                        <td className={styles.mono}>{formatExampleTarget(unit, readStoredNumber(row.value))}</td>
                        <td className={styles.mono}>{formatTimestampDate(row.effective_from)}</td>
                        <td>{savedByLabel(row.created_by_email, people)}</td>
                        <td>{row.change_reason ?? ''}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <Link href={`/kpis/scorecards?quarter=${quarterParam(scorecard.fy, scorecard.quarter)}`} className={styles.backLink}>
        Back to scorecards
      </Link>
    </main>
  )
}
