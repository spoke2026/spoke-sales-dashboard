// The window selector (PRD 12.1, D12). Server component: no client state, just
// links built by lib/kpi/window.js. Reused by Phase 3b.

import Link from 'next/link'
import { formatLongDate } from '@/lib/kpi/format'
import styles from './kpis.module.css'

export default function WindowSelector({ basePath, resolved, options }) {
  const detailsOpen = options.months.some(m => m.key === resolved.chipKey) ||
    (options.quarters.some(q => q.key === resolved.chipKey)) ||
    resolved.chipKey === null

  return (
    <>
      {resolved.notice && (
        <div className={styles.versionNotice} role="note">
          <p className={styles.confirmText}>{resolved.notice}</p>
        </div>
      )}

      <nav aria-label="Choose a window" className={styles.windowBar}>
        <p>
          Showing <strong>{resolved.label}</strong>
        </p>
        <ul className={styles.chipRow}>
          {options.periods.map(period => (
            <li key={period.key}>
              <Link
                href={period.href}
                className={styles.chip}
                aria-current={resolved.chipKey === period.key ? 'true' : undefined}
              >
                {period.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <details className={styles.windowMore} open={detailsOpen}>
        <summary>Months, quarters, and custom range</summary>

        <p className={styles.chipGroupLabel}>Months in {options.fyLabel}</p>
        <ul className={styles.chipRow}>
          {options.months.map(month => (
            <li key={month.key}>
              {month.href ? (
                <Link href={month.href} className={styles.chip} aria-current={resolved.chipKey === month.key ? 'true' : undefined}>
                  {month.short}<span className={styles.visuallyHidden}>{month.hiddenYear}</span>
                </Link>
              ) : (
                <span className={styles.chipDisabled}>
                  {month.short}<span className={styles.visuallyHidden}>{month.hiddenYear} (not started yet)</span>
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className={styles.chipGroupLabel}>Quarters in {options.fyLabel}</p>
        <ul className={styles.chipRow}>
          {options.quarters.map(quarter => (
            <li key={quarter.key}>
              {quarter.href ? (
                <Link href={quarter.href} className={styles.chip} aria-current={resolved.chipKey === quarter.key ? 'true' : undefined}>
                  {quarter.short}<span className={styles.visuallyHidden}>{quarter.hidden}</span>
                </Link>
              ) : (
                <span className={styles.chipDisabled}>
                  {quarter.short}<span className={styles.visuallyHidden}>{quarter.hidden} (not started yet)</span>
                </span>
              )}
            </li>
          ))}
        </ul>

        <form className={styles.rangeForm} method="get" action={basePath}>
          <input type="hidden" name="window" value="range" />
          <div className={styles.field}>
            <label htmlFor="range-from">From</label>
            <input
              id="range-from"
              type="date"
              name="from"
              className={styles.input}
              min={options.calendarStart}
              max={options.calendarEnd}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="range-to">To</label>
            <input
              id="range-to"
              type="date"
              name="to"
              className={styles.input}
              min={options.calendarStart}
              max={options.calendarEnd}
            />
          </div>
          <p className={styles.helper}>
            Up to 366 days, between {formatLongDate(options.calendarStart)} and{' '}
            {formatLongDate(options.calendarEnd)}.
          </p>
          <button type="submit" className={styles.btnSecondary}>Show range</button>
        </form>
      </details>
    </>
  )
}
