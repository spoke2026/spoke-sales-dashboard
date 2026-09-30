import { Suspense } from 'react'
import AppNav from '@/components/AppNav'
import KpiSignOut from '@/components/KpiSignOut'
import HeaderControls from './HeaderControls'
import styles from '@/app/kpis/kpis.module.css'

// Same shell as the KPI pages (Mineral header, section nav), with the Sales
// header's month selector and sync indicator on the right.
export default function MarketingLayout({ children }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <img src="/spoke-logo-white.png" alt="Spoke" className={styles.logoImg} />
          <div className={styles.divider} />
          <span className={styles.appName}>Sales Performance Dashboard</span>
          <AppNav compact={false} />
        </div>
        <Suspense fallback={<KpiSignOut />}>
          <HeaderControls />
        </Suspense>
      </header>
      {children}
    </div>
  )
}
