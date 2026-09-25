import AppNav from '@/components/AppNav'
import KpiSignOut from '@/components/KpiSignOut'
import styles from './kpis.module.css'

export default function KpisLayout({ children }) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brandRow}>
          <img src="/spoke-logo-white.png" alt="Spoke" className={styles.logoImg} />
          <div className={styles.divider} />
          <span className={styles.appName}>Sales Performance Dashboard</span>
          <AppNav compact={false} />
        </div>
        <KpiSignOut />
      </header>
      {children}
    </div>
  )
}
