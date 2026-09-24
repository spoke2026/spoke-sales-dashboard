import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { labelFor, formatExampleTarget, latestVersions, readStoredNumber, savedByLabel } from '@/lib/kpi/library'
import { formatTimestampDate } from '@/lib/kpi/format'
import StatusActions from './StatusActions'
import styles from '../../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'KPI details | Spoke Sales Dashboard' }

// Same UUID regex text as lib/kpi/admin.js (private there) and lib/kpi/library.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const NOTICES = {
  proposed: 'KPI proposed.',
  saved: 'New version saved.',
}

function NotFound() {
  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPI library</p>
      <h1 className={styles.pageTitle}>KPI not found</h1>
      <p className={styles.lede}>
        That KPI doesn&apos;t exist. It may have been a test entry that was removed.
      </p>
      <Link href="/kpis/library" className={styles.backLink}>Back to the KPI library</Link>
    </main>
  )
}

export default async function KpiDetailPage({ params, searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  if (!UUID_RE.test(params.id)) {
    return <NotFound />
  }

  const { data: isAdminData, error: adminError } = await supabase.rpc('is_admin')
  const isAdmin = !adminError && isAdminData === true

  const [definitionRes, personRes] = await Promise.all([
    supabase.from('kpi_definition').select('*').eq('id', params.id),
    supabase.from('kpi_person').select('full_name, email'),
  ])

  if (definitionRes.error || personRes.error) {
    console.error('KPI detail page query error', definitionRes.error, personRes.error)
    return (
      <main className={styles.main}>
        <p className={styles.eyebrow}>KPI library</p>
        <h1 className={styles.pageTitle}>KPI library</h1>
        <p className={styles.errorState} role="alert">
          We couldn&apos;t load the KPI library. Refresh the page to try again.
        </p>
      </main>
    )
  }

  const rows = definitionRes.data ?? []
  if (rows.length === 0) {
    return <NotFound />
  }

  const people = personRes.data ?? []
  const [current] = latestVersions(rows)
  const version1 = rows.find(r => r.version === 1) ?? current

  const requestedVersion = searchParams?.version
  const requestedVersionNumber = typeof requestedVersion === 'string' && /^\d+$/.test(requestedVersion)
    ? Number(requestedVersion)
    : null
  const shown = requestedVersionNumber !== null
    ? rows.find(r => r.version === requestedVersionNumber) ?? current
    : current

  const isCurrent = shown.version === current.version

  const notice = typeof searchParams?.notice === 'string' && Object.prototype.hasOwnProperty.call(NOTICES, searchParams.notice)
    ? NOTICES[searchParams.notice]
    : null

  const proposedByName = savedByLabel(version1.created_by_email, people)

  const historyRows = [...rows].sort((a, b) => b.version - a.version)

  return (
    <main className={styles.main}>
      {notice && <p className={styles.statusMsg} role="status">{notice}</p>}

      <p className={styles.eyebrow}>KPI library</p>
      <h1 className={styles.pageTitle}>{shown.name}</h1>
      <div className={styles.statusLine}>
        <span className={styles.statusTag}>{labelFor('status', shown.status)}</span>
        <span className={styles.mono}>Version {shown.version}</span>
        {shown.status === 'retired' && <span>Not available for new scorecards</span>}
      </div>

      {!isCurrent && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>
            You&apos;re viewing version {shown.version}. The current version is {current.version}.{' '}
            <Link href={`/kpis/library/${params.id}`}>View the current version</Link>
          </p>
        </div>
      )}

      {isAdmin && isCurrent && (
        <StatusActions
          id={params.id}
          version={shown.version}
          status={shown.status}
          editHref={shown.status !== 'retired' ? `/kpis/library/${params.id}/edit` : null}
        />
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Definition</h2>
        </div>
        <dl className={styles.definitionList}>
          <dt>Description</dt>
          <dd>{shown.description}</dd>

          <dt>Type</dt>
          <dd>{labelFor('kpiType', shown.kpi_type)}</dd>

          <dt>Unit</dt>
          <dd>{labelFor('unit', shown.unit)}</dd>

          <dt>Direction</dt>
          <dd>{labelFor('direction', shown.direction)}</dd>

          <dt>How values combine</dt>
          <dd>{labelFor('aggregation', shown.aggregation)}</dd>

          <dt>Target spread</dt>
          <dd>{labelFor('phasing', shown.phasing)}</dd>

          <dt>Data source</dt>
          <dd>{labelFor('source', shown.source)}</dd>

          <dt>Source mapping</dt>
          <dd>
            {shown.source_mapping === null ? (
              shown.source === 'manual'
                ? 'Not needed for manual entry.'
                : 'Not set yet. Needed before this KPI can pull data.'
            ) : (
              <pre className={styles.codeBlock}>{JSON.stringify(shown.source_mapping, null, 2)}</pre>
            )}
          </dd>

          <dt>Who it counts towards</dt>
          <dd>
            {shown.attribution === null ? (
              'Not set'
            ) : (
              <>
                {labelFor('attributionMethod', shown.attribution.method)}
                {shown.attribution.note !== null && shown.attribution.note !== undefined && (
                  <>{'\n'}{shown.attribution.note}</>
                )}
              </>
            )}
          </dd>

          <dt>Example monthly target</dt>
          <dd>{formatExampleTarget(shown.unit, readStoredNumber(shown.example_target))}</dd>

          <dt>Proposed by</dt>
          <dd>{proposedByName} on {formatTimestampDate(version1.created_at)}</dd>
        </dl>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Version history</h2>
        </div>
        <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Version history table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>Version history</caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Saved on</th>
                <th scope="col">Saved by</th>
                <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {historyRows.map(row => (
                <tr key={row.version}>
                  <td className={styles.mono}>v{row.version}</td>
                  <td className={styles.mono}>{formatTimestampDate(row.created_at)}</td>
                  <td>{savedByLabel(row.created_by_email, people)}</td>
                  <td>
                    <Link href={`/kpis/library/${params.id}?version=${row.version}`} className={styles.backLink}>
                      View version {row.version} <span className={styles.visuallyHidden}>{current.name}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Test this KPI</h2>
        </div>
        <button type="button" disabled aria-describedby="kpi-test-note" className={styles.btnSecondary}>
          Preview last 90 days
        </button>
        <p id="kpi-test-note" className={styles.helper}>
          Not available until a data source is connected.
        </p>
      </section>

      <Link href="/kpis/library" className={styles.backLink}>Back to the KPI library</Link>
    </main>
  )
}
