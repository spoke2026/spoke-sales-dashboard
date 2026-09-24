import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { latestVersions, labelFor, savedByLabel } from '@/lib/kpi/library'
import styles from '../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'KPI library | Spoke Sales Dashboard' }

export default async function KpiLibraryPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const [definitionRes, personRes] = await Promise.all([
    supabase
      .from('kpi_definition')
      .select('id, version, name, kpi_type, unit, direction, source, status, created_by_email'),
    supabase.from('kpi_person').select('full_name, email'),
  ])

  if (definitionRes.error || personRes.error) {
    console.error('KPI library page query error', definitionRes.error, personRes.error)
    return (
      <main className={styles.main}>
        <p className={styles.eyebrow}>KPIs</p>
        <h1 className={styles.pageTitle}>KPI library</h1>
        <p className={styles.errorState} role="alert">
          We couldn&apos;t load the KPI library. Refresh the page to try again.
        </p>
      </main>
    )
  }

  const rows = definitionRes.data ?? []
  const people = personRes.data ?? []
  const current = latestVersions(rows)

  const version1ById = new Map()
  for (const row of rows) {
    if (row.version === 1) version1ById.set(row.id, row)
  }

  const published = current.filter(row => row.status === 'published')
  const proposed = current.filter(row => row.status === 'proposed')
  const retired = current.filter(row => row.status === 'retired')

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPIs</p>
      <h1 className={styles.pageTitle}>KPI library</h1>
      <p className={styles.lede}>
        Every KPI on a scorecard comes from this library. Anyone can propose a KPI. The admin
        publishes it so definitions stay consistent.
      </p>
      <div className={styles.actionsRow}>
        <Link href="/kpis/library/new" className={styles.manageLink}>
          Propose a KPI
        </Link>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Published</h2>
        </div>
        {published.length === 0 ? (
          <p className={styles.emptyState}>
            No published KPIs yet. Propose one, and the admin can publish it.
          </p>
        ) : (
          <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Published KPIs table">
            <table className={styles.table}>
              <caption className={styles.visuallyHidden}>Published KPIs</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Source</th>
                  <th scope="col">Version</th>
                </tr>
              </thead>
              <tbody>
                {published.map(row => (
                  <tr key={row.id}>
                    <td><Link href={`/kpis/library/${row.id}`} className={styles.backLink}>{row.name}</Link></td>
                    <td>{labelFor('kpiType', row.kpi_type)}</td>
                    <td>{labelFor('unit', row.unit)}</td>
                    <td>{labelFor('direction', row.direction)}</td>
                    <td>{labelFor('source', row.source)}</td>
                    <td className={styles.mono}>v{row.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Proposed</h2>
        </div>
        {proposed.length === 0 ? (
          <p className={styles.emptyState}>No proposals waiting. Anyone can propose a KPI.</p>
        ) : (
          <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Proposed KPIs table">
            <table className={styles.table}>
              <caption className={styles.visuallyHidden}>Proposed KPIs</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Source</th>
                  <th scope="col">Version</th>
                  <th scope="col">Proposed by</th>
                </tr>
              </thead>
              <tbody>
                {proposed.map(row => (
                  <tr key={row.id}>
                    <td><Link href={`/kpis/library/${row.id}`} className={styles.backLink}>{row.name}</Link></td>
                    <td>{labelFor('kpiType', row.kpi_type)}</td>
                    <td>{labelFor('unit', row.unit)}</td>
                    <td>{labelFor('direction', row.direction)}</td>
                    <td>{labelFor('source', row.source)}</td>
                    <td className={styles.mono}>v{row.version}</td>
                    <td>{savedByLabel(version1ById.get(row.id)?.created_by_email, people)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.sectionTitle}>Retired</h2>
        </div>
        <p className={styles.helper}>
          Retired KPIs stay on past scorecards but can&apos;t be added to new ones.
        </p>
        {retired.length === 0 ? (
          <p className={styles.emptyState}>No retired KPIs.</p>
        ) : (
          <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Retired KPIs table">
            <table className={styles.table}>
              <caption className={styles.visuallyHidden}>Retired KPIs</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Type</th>
                  <th scope="col">Unit</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Source</th>
                  <th scope="col">Version</th>
                  <th scope="col">Availability</th>
                </tr>
              </thead>
              <tbody>
                {retired.map(row => (
                  <tr key={row.id}>
                    <td><Link href={`/kpis/library/${row.id}`} className={styles.backLink}>{row.name}</Link></td>
                    <td>{labelFor('kpiType', row.kpi_type)}</td>
                    <td>{labelFor('unit', row.unit)}</td>
                    <td>{labelFor('direction', row.direction)}</td>
                    <td>{labelFor('source', row.source)}</td>
                    <td className={styles.mono}>v{row.version}</td>
                    <td>Not available for new scorecards</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
