'use client'

import { Suspense } from 'react'
import {
  campaignsInMonth, emailTotals, postsInView, followerRowsWithChange, linkedinTotals, weeksInMonth, webTotals,
} from '@/lib/marketing/totals'
import { ChipFilter } from './shared'
import { MonthSelect } from './HeaderControls'
import DashboardCards from './DashboardCards'
import EmailSection from './EmailSection'
import LinkedInSection from './LinkedInSection'
import WebsiteSection from './WebsiteSection'
import dash from '@/app/dashboard.module.css'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

const ACCOUNT_CHOICES = [
  { value: 'both', label: 'Both' },
  { value: 'spoke', label: 'Spoke page' },
  { value: 'ed', label: 'Ed' },
]

export default function MarketingView({ months, month, account, isAdmin, campaigns, posts, followers, weeks, sync }) {
  const query = { month, account }

  const shownCampaigns = campaignsInMonth(campaigns, month)
  const shownPosts = postsInView(posts, month, account)
  const followerRows = followerRowsWithChange(followers)
  const shownFollowers = account === 'both' ? followers : followers.filter(f => f.account === account)

  const syncErrors = [
    sync.mailchimp.lastError && `Mailchimp: ${sync.mailchimp.lastError}`,
    sync.vercel.lastError && `Vercel: ${sync.vercel.lastError}`,
  ].filter(Boolean)

  return (
    <>
      {/* On phones the header hides its month selector, so it shows here. */}
      <div className={mkt.mobileBar}>
        <label htmlFor="mobile-month" className={styles.statLabel}>Month</label>
        <Suspense fallback={null}>
          <MonthSelect id="mobile-month" className={styles.select} />
        </Suspense>
      </div>

      {syncErrors.length > 0 && (
        <p className={`${styles.errorState} ${mkt.syncAlert}`} role="alert">
          The last update didn&apos;t finish. {syncErrors.join(' ')}
        </p>
      )}

      <DashboardCards
        month={month}
        months={months}
        account={account}
        campaigns={shownCampaigns}
        allCampaigns={campaigns}
        emailTotals={emailTotals(shownCampaigns)}
        posts={shownPosts}
        linkedin={linkedinTotals(shownPosts, followerRows, month, account)}
        followers={shownFollowers}
        allWeeks={weeks}
        web={webTotals(weeksInMonth(weeks, month))}
        accountFilter={<ChipFilter label="LinkedIn account" param="account" value={account} options={ACCOUNT_CHOICES} query={query} />}
      />

      <div className={mkt.panels}>
        <EmailSection campaigns={campaigns} month={month} isAdmin={isAdmin} sync={sync.mailchimp} />
        <LinkedInSection posts={posts} followers={followers} month={month} months={months} account={account} isAdmin={isAdmin} />
        <WebsiteSection weeks={weeks} month={month} isAdmin={isAdmin} sync={sync.vercel} />
      </div>

      <footer className={`${dash.footer} ${mkt.footer}`}>
        <span>Email from Mailchimp{sync.mailchimp.lastUpdated ? `, updated ${sync.mailchimp.lastUpdated}` : ''}</span>
        <span>Website from Vercel{sync.vercel.lastUpdated ? `, updated ${sync.vercel.lastUpdated}` : ''}</span>
        <span>LinkedIn typed in by hand</span>
        <span>Times shown in NZT</span>
      </footer>
    </>
  )
}
