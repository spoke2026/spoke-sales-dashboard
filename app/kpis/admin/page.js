import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminPanels from './AdminPanels'
import styles from '../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'People and teams | Spoke Sales Dashboard' }

export default async function KpiAdminPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: isAdminData, error: adminError } = await supabase.rpc('is_admin')
  const isAdmin = !adminError && isAdminData === true

  if (!isAdmin) {
    return (
      <main className={styles.main}>
        <h1 className={styles.pageTitle}>People and teams</h1>
        <p className={styles.lede}>Only the admin can manage people and teams.</p>
        <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
      </main>
    )
  }

  const [teamRes, personRes, closureRes, minDateRes, maxDateRes] = await Promise.all([
    supabase.from('kpi_team').select('id, name, active').order('name'),
    supabase
      .from('kpi_person')
      .select('id, full_name, email, primary_team_id, manager_id, is_contractor, scorecard_type, active')
      .order('full_name'),
    supabase.from('kpi_company_closure').select('date, reason').order('date'),
    supabase.from('kpi_calendar_day').select('date').order('date', { ascending: true }).limit(1),
    supabase.from('kpi_calendar_day').select('date').order('date', { ascending: false }).limit(1),
  ])

  if (
    teamRes.error || personRes.error || closureRes.error ||
    minDateRes.error || maxDateRes.error
  ) {
    console.error(
      'KPI admin page query error',
      teamRes.error, personRes.error, closureRes.error, minDateRes.error, maxDateRes.error
    )
    return (
      <main className={styles.main}>
        <h1 className={styles.pageTitle}>People and teams</h1>
        <p className={styles.errorState} role="alert">
          We couldn&apos;t load the KPI setup. Refresh the page to try again.
        </p>
      </main>
    )
  }

  const range = {
    min: minDateRes.data?.[0]?.date ?? null,
    max: maxDateRes.data?.[0]?.date ?? null,
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.pageTitle}>People and teams</h1>
      <p className={styles.lede}>
        Set who is scored, which team they sit in, and who they report to. Every change is logged.
      </p>
      <Link href="/kpis" className={styles.backLink}>Back to KPIs</Link>
      <AdminPanels
        teams={teamRes.data ?? []}
        people={personRes.data ?? []}
        closures={closureRes.data ?? []}
        range={range}
      />
    </main>
  )
}
