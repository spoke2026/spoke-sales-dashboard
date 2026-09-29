import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { monthOptions, parseMonthParam } from '@/lib/marketing/months'
import { formatDateTime } from '@/lib/marketing/format'
import MarketingView from './MarketingView'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Marketing | Spoke Sales Dashboard' }

const ACCOUNT_FILTERS = ['both', 'spoke', 'ed']

export default async function MarketingPage({ searchParams }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/login')
  }

  const { data: isAdminData, error: adminError } = await supabase.rpc('is_admin')
  const isAdmin = !adminError && isAdminData === true

  const months = monthOptions()
  const month = parseMonthParam(searchParams?.month, months)
  const account = ACCOUNT_FILTERS.includes(searchParams?.account) ? searchParams.account : 'both'

  const [campaignRes, postRes, followerRes, weekRes, syncRes] = await Promise.all([
    supabase
      .from('mkt_email_campaign')
      .select('id, send_time, campaign_name, subject_line, recipients, unique_opens, open_rate, unique_clicks, click_rate, click_to_open, replies, enquiries')
      .order('send_time', { ascending: false }),
    supabase
      .from('mkt_social_post')
      .select('id, account, posted_on, topic, likes, comments, url')
      .eq('platform', 'linkedin')
      .order('posted_on', { ascending: false }),
    supabase
      .from('mkt_follower_count')
      .select('id, account, month, followers')
      .eq('platform', 'linkedin')
      .order('month', { ascending: false }),
    supabase
      .from('mkt_web_week')
      .select('id, week_start, visitors, page_views, top_pages, top_referrers, source')
      .order('week_start', { ascending: false }),
    supabase
      .from('mkt_sync_log')
      .select('finished_at, ok, error')
      .eq('source', 'mailchimp')
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(20),
  ])

  const failed = [campaignRes, postRes, followerRes, weekRes, syncRes].filter(r => r.error)
  if (failed.length > 0) {
    console.error('Marketing page query error', ...failed.map(r => r.error))
    return (
      <main className={`${styles.main} ${mkt.main}`}>
        <p className={styles.eyebrow}>Marketing</p>
        <h1 className={styles.pageTitle}>Marketing</h1>
        <p className={styles.errorState} role="alert">
          We couldn&apos;t load the marketing numbers. Refresh the page to try again.
        </p>
      </main>
    )
  }

  const syncRows = syncRes.data ?? []
  const lastOk = syncRows.find(r => r.ok)
  const latest = syncRows[0]
  const sync = {
    lastUpdated: lastOk ? formatDateTime(lastOk.finished_at) : null,
    lastError: latest && !latest.ok ? latest.error : null,
  }

  return (
    <main className={`${styles.main} ${mkt.main}`}>
      <p className={styles.eyebrow}>Marketing</p>
      <h1 className={styles.pageTitle}>Marketing</h1>
      <p className={styles.lede}>
        Email, LinkedIn and website results by month.
        {isAdmin ? '' : ' Only the admin can change these numbers.'}
      </p>
      <MarketingView
        months={months}
        month={month}
        account={account}
        isAdmin={isAdmin}
        campaigns={campaignRes.data ?? []}
        posts={postRes.data ?? []}
        followers={followerRes.data ?? []}
        weeks={weekRes.data ?? []}
        sync={sync}
      />
    </main>
  )
}
