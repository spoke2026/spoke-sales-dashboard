'use client'

import { ALL_MONTHS, monthLabel, shortMonthLabel } from '@/lib/marketing/months'
import { ChipFilter } from './shared'
import EmailSection from './EmailSection'
import LinkedInSection from './LinkedInSection'
import WebsiteSection from './WebsiteSection'
import styles from '@/app/kpis/kpis.module.css'

export default function MarketingView({ months, month, account, isAdmin, campaigns, posts, followers, weeks, sync }) {
  const query = { month, account }
  const monthChoices = [
    { value: ALL_MONTHS, label: 'All months' },
    ...months.map(m => ({ value: m, label: shortMonthLabel(m) })),
  ]

  return (
    <>
      <div className={styles.windowBar}>
        <span className={styles.statLabel}>Showing {monthLabel(month)}</span>
        <ChipFilter label="Month" param="month" value={month} options={monthChoices} query={query} />
      </div>

      <EmailSection campaigns={campaigns} month={month} isAdmin={isAdmin} sync={sync} />
      <LinkedInSection
        posts={posts}
        followers={followers}
        month={month}
        months={months}
        account={account}
        query={query}
        isAdmin={isAdmin}
      />
      <WebsiteSection weeks={weeks} month={month} isAdmin={isAdmin} />
    </>
  )
}
