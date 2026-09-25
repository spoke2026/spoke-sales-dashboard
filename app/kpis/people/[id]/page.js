import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/kpi/library'
import { todayInAuckland, monthStartOf, monthEndOf, eachDate } from '@/lib/kpi/calendar'
import { parseWindowParams, resolveWindow, windowOptions } from '@/lib/kpi/window'
import { buildPersonScorecard, fetchAllRows } from '@/lib/kpi/view'
import WindowSelector from '../../WindowSelector'
import styles from '../../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Person scorecard | Spoke Sales Dashboard' }

function NotFound() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Person scorecard</p>
      <h1 className={styles.pageTitle}>Person not found</h1>
      <p className={styles.lede}>
        That person doesn&apos;t exist. They may have been a test entry that was removed.
      </p>
      <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
    </main>
  )
}

function ErrorState() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>Person scorecard</p>
      <h1 className={styles.pageTitle}>Person scorecard</h1>
      <p className={styles.errorState} role="alert">
        We couldn&apos;t load this scorecard. Refresh the page to try again.
      </p>
    </main>
  )
}

export default async function PersonScorecardPage({ params, searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  if (!isUuid(params.id)) {
    return <NotFound />
  }

  const [personRes, quarterMonthsRes, entryPeopleRes, scorecardRes] = await Promise.all([
    supabase.from('kpi_person').select('id, full_name, scorecard_type, is_contractor, active').eq('id', params.id),
    supabase.rpc('kpi_quarter_months'),
    supabase.rpc('kpi_entry_people'),
    supabase.from('kpi_scorecard').select('id, fy, quarter, status').eq('person_id', params.id),
  ])

  if (personRes.error || quarterMonthsRes.error || entryPeopleRes.error || scorecardRes.error) {
    console.error(
      'Person scorecard page query error',
      personRes.error,
      quarterMonthsRes.error,
      entryPeopleRes.error,
      scorecardRes.error
    )
    return <ErrorState />
  }

  if (personRes.data.length === 0) {
    return <NotFound />
  }
  const person = personRes.data[0]
  const quarterMonthRows = quarterMonthsRes.data ?? []
  const entryPeople = entryPeopleRes.data ?? []
  const scorecards = scorecardRes.data ?? []
  const canEnter = entryPeople.includes(person.id)

  const actionsRow = (
    <div className={styles.actionsRow}>
      {canEnter && (
        <Link href={`/kpis/entry?person=${person.id}`} className={styles.manageLink}>
          Enter actuals
        </Link>
      )}
      <Link href="/kpis/scorecards" className={styles.manageLink}>Scorecards</Link>
    </div>
  )

  const header = (
    <>
      <p className={styles.eyebrow}>Person scorecard</p>
      <h1 className={styles.pageTitle}>{person.full_name}</h1>
      <div className={styles.statusLine}>
        {person.is_contractor && <span className={styles.statusTag}>Contractor</span>}
        {!person.active && <span className={styles.statusTag}>Inactive</span>}
      </div>
      <p className={styles.lede}>
        Each KPI is green when its actual meets its target to date for the window, and red when it
        doesn&apos;t. Missing data counts as red.
      </p>
      {actionsRow}
    </>
  )

  if (person.scorecard_type === 'company_only') {
    return (
      <main className={styles.main}>
        {header}
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>
            {person.full_name}&apos;s KPIs sit on the company scorecard, so there&apos;s no person scorecard.
          </p>
        </div>
        <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
      </main>
    )
  }

  const today = todayInAuckland()
  const parsed = parseWindowParams({
    window: searchParams?.window,
    from: searchParams?.from,
    to: searchParams?.to,
  })

  let resolved
  try {
    resolved = resolveWindow(parsed, today, quarterMonthRows)
  } catch (err) {
    console.error('Person scorecard page window error', err)
    return <ErrorState />
  }

  const targetsRes = await supabase.rpc('kpi_window_targets', {
    p_person_id: person.id,
    p_start: resolved.start,
    p_end: resolved.end,
  })

  if (targetsRes.error) {
    console.error('Person scorecard page query error', targetsRes.error)
    return <ErrorState />
  }
  const targetRows = targetsRes.data ?? []
  const kpiIds = [...new Set(targetRows.map(r => r.kpi_definition_id))]

  const [definitionRes, calendarRes] = await Promise.all([
    kpiIds.length > 0
      ? supabase
          .from('kpi_definition')
          .select('id, version, name, kpi_type, unit, direction, aggregation, phasing, source')
          .in('id', kpiIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('kpi_calendar_day')
      .select('date, is_working_day')
      .gte('date', monthStartOf(resolved.start))
      .lte('date', monthEndOf(resolved.end))
      .order('date'),
  ])

  if (definitionRes.error || calendarRes.error) {
    console.error('Person scorecard page query error', definitionRes.error, calendarRes.error)
    return <ErrorState />
  }

  const calendarRows = calendarRes.data ?? []
  const expectedDates = eachDate(monthStartOf(resolved.start), monthEndOf(resolved.end))
  if (calendarRows.length !== expectedDates.length) {
    console.error('Person scorecard page calendar row count mismatch', calendarRows.length, expectedDates.length)
    return <ErrorState />
  }

  let actualsResult = { data: [] }
  if (kpiIds.length > 0) {
    actualsResult = await fetchAllRows((from, to) =>
      supabase
        .from('kpi_actual_daily')
        .select('kpi_definition_id, date, value, numerator, denominator')
        .eq('person_id', person.id)
        .in('kpi_definition_id', kpiIds)
        .gte('date', resolved.start)
        .lte('date', resolved.end)
        .order('kpi_definition_id')
        .order('date')
        .range(from, to)
    )
  }

  if (actualsResult.error) {
    console.error('Person scorecard page query error', actualsResult.error)
    return <ErrorState />
  }

  let scorecardView
  try {
    scorecardView = buildPersonScorecard({
      window: { start: resolved.start, end: resolved.end },
      today,
      calendar: calendarRows,
      targetRows,
      definitions: definitionRes.data ?? [],
      actuals: actualsResult.data,
      quarterMonthRows,
      scorecards,
    })
  } catch (err) {
    console.error('Person scorecard page build error', err)
    return <ErrorState />
  }
  const { cards, quarterNote, empty } = scorecardView

  const options = windowOptions(today, quarterMonthRows, `/kpis/people/${person.id}`)

  return (
    <main className={styles.main}>
      {header}

      <WindowSelector basePath={`/kpis/people/${person.id}`} resolved={resolved} options={options} />

      {quarterNote && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{quarterNote}</p>
        </div>
      )}

      <section aria-labelledby="kpis-heading">
        <h2 id="kpis-heading" className={styles.sectionTitle}>KPIs</h2>
        {empty ? (
          <p className={styles.emptyState}>No approved KPIs for this window.</p>
        ) : (
          <ul className={styles.kpiCards}>
            {cards.map(card => (
              <li key={card.kpiId}>
                <article className={styles.kpiCard}>
                  <h3 className={styles.kpiCardTitle}>
                    <Link href={`/kpis/library/${card.kpiId}?version=${card.version}`}>{card.name}</Link>
                  </h3>
                  <p className={styles.kpiMeta}>{card.meta}</p>
                  {card.error ? (
                    <p className={styles.errorState} role="alert">{card.error}</p>
                  ) : (
                    <>
                      <p className={`${styles.statusBadge} ${card.status === 'GREEN' ? styles.statusGreen : styles.statusRed}`}>
                        <span className={styles.visuallyHidden}>Status: </span>
                        <span aria-hidden="true">{card.symbol}</span> {card.statusLabel}
                      </p>
                      {card.figures && (
                        <dl className={styles.figures}>
                          <dt>Actual</dt>
                          <dd className={styles.mono}>{card.figures.actual}</dd>
                          <dt>Target to date</dt>
                          <dd className={styles.mono}>{card.figures.targetToDate}</dd>
                          <dt>Full window target</dt>
                          <dd className={styles.mono}>{card.figures.fullTarget}</dd>
                          <dt>Variance</dt>
                          <dd className={styles.mono}>{card.figures.variance}</dd>
                        </dl>
                      )}
                      {card.notes.map((note, i) => <p key={i} className={styles.cardNote}>{note}</p>)}
                    </>
                  )}
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
    </main>
  )
}
