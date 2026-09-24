'use client'

import { createClient } from '@/lib/supabase/client'
import styles from '@/app/kpis/kpis.module.css'

export default function KpiSignOut() {
  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/login')
  }

  return (
    <button type="button" className={styles.signOutBtn} onClick={handleSignOut}>
      Sign out
    </button>
  )
}
