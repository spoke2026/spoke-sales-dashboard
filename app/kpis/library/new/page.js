import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import DefinitionForm from '../DefinitionForm'
import styles from '../../kpis.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Propose a KPI | Spoke Sales Dashboard' }

export default async function ProposeKpiPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  return (
    <main className={styles.main}>
      <p className={styles.eyebrow}>KPI library</p>
      <h1 className={styles.pageTitle}>Propose a KPI</h1>
      <p className={styles.lede}>
        Describe the KPI and how it&apos;s measured. The admin reviews it before it can go on a
        scorecard.
      </p>
      <DefinitionForm mode="propose" />
    </main>
  )
}
