import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { latestVersions, readStoredNumber, toDisplayNumber } from '@/lib/kpi/library'
import DefinitionForm from '../../DefinitionForm'
import styles from '../../../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Edit KPI | Spoke Sales Dashboard' }

// Same UUID regex text as lib/kpi/admin.js (private there) and lib/kpi/library.js.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export default async function EditKpiPage({ params }) {
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

  if (!isAdmin) {
    return (
      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Edit KPI</h1>
        <p className={styles.lede}>Only the admin can edit KPIs.</p>
        <Link href={`/kpis/library/${params.id}`} className={styles.backLink}>Back to the KPI</Link>
      </main>
    )
  }

  const { data: rows, error } = await supabase.from('kpi_definition').select('*').eq('id', params.id)

  if (error) {
    console.error('KPI edit page query error', error)
    return (
      <main className={styles.main}>
        <p className={styles.eyebrow}>KPI library</p>
        <h1 className={styles.pageTitle}>Edit KPI</h1>
        <p className={styles.errorState} role="alert">
          We couldn&apos;t load the KPI library. Refresh the page to try again.
        </p>
      </main>
    )
  }

  if (!rows || rows.length === 0) {
    return <NotFound />
  }

  const [current] = latestVersions(rows)

  if (current.status === 'retired') {
    return (
      <main className={styles.main}>
        <h1 className={styles.pageTitle}>Edit KPI</h1>
        <p className={styles.lede}>Retired KPIs can&apos;t be edited.</p>
        <Link href={`/kpis/library/${params.id}`} className={styles.backLink}>Back to the KPI</Link>
      </main>
    )
  }

  // An unreadable stored value is shown as typed text, never silently blanked.
  const exampleTarget = readStoredNumber(current.example_target)
  const attribution = current.attribution !== null && typeof current.attribution === 'object' ? current.attribution : null
  const initial = {
    name: current.name,
    description: current.description,
    kpiType: current.kpi_type,
    unit: current.unit,
    direction: current.direction,
    aggregation: current.aggregation,
    attributionMethod: attribution !== null && typeof attribution.method === 'string' ? attribution.method : '',
    phasing: current.phasing,
    source: current.source,
    sourceMapping: current.source_mapping === null ? '' : JSON.stringify(current.source_mapping, null, 2),
    attributionNote: attribution !== null && typeof attribution.note === 'string' ? attribution.note : '',
    exampleTarget: exampleTarget === null
      ? ''
      : Number.isNaN(exampleTarget)
        ? String(current.example_target)
        : String(toDisplayNumber(current.unit, exampleTarget)),
  }

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPI library</p>
      <h1 className={styles.pageTitle}>Edit KPI</h1>
      <p className={styles.lede}>
        Saving creates version {current.version + 1}. Past scorecards keep the version they used,
        so history never changes.
      </p>
      <DefinitionForm mode="edit" id={params.id} version={current.version} initial={initial} />
    </main>
  )
}
