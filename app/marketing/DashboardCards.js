'use client'

import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'
import { monthLabel, shortMonthLabel, monthOfDate } from '@/lib/marketing/months'
import { ACCOUNT_LABELS } from '@/lib/marketing/totals'
import {
  weeklySeries, visitorChange, share, campaignSeries, monthlyResponses, postSeries, followerSeries,
} from '@/lib/marketing/visual'
import { formatChange, formatCount, formatDecimal, formatPercent } from '@/lib/marketing/format'
import dash from '@/app/dashboard.module.css'
import mkt from './marketing.module.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Filler)

// Same chart look as the Sales tab: Mineral for actuals, Zest for the
// secondary series, quiet dashed gridlines, no legend inside the canvas.
const MINERAL = '#40514F'
const ZEST = '#BEDA81'
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 400 },
  plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
}
const bigScales = {
  x: { grid: { display: false }, border: { color: 'rgba(64,81,79,.18)' }, ticks: { maxTicksLimit: 8, font: { size: 10 } } },
  y: { min: 0, grid: { color: 'rgba(64,81,79,.1)', borderDash: [3, 3] }, border: { display: false }, ticks: { maxTicksLimit: 5, precision: 0, font: { size: 10 } } },
}
const smallScales = {
  x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 4, font: { size: 9 } } },
  y: { min: 0, grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 3, precision: 0, font: { size: 9 } } },
}

export default function DashboardCards({ month, months, account, campaigns, allCampaigns, emailTotals, posts, linkedin, followers, allWeeks, web, accountFilter }) {
  const series = weeklySeries(allWeeks, month)
  const change = visitorChange(allWeeks, month)
  const fromMarketing = web.fromLinkedIn + web.fromMailchimp
  const marketingShare = share(fromMarketing, web.visitors)

  return (
    <>
      {/* TOP CARD: website traffic */}
      <section className={`${dash.card} ${dash.topCard} ${mkt.topCard}`} aria-labelledby="web-title">
        <div className={dash.salesLeft}>
          <div>
            <h2 id="web-title" className={dash.sectionLabel}>
              Website visitors <span className={dash.sectionLabelNote}>· {monthLabel(month)}</span>
            </h2>
            <div className={dash.bigNumber}>{formatCount(web.visitors)}</div>
            <p className={dash.budgetLine}>{formatCount(web.pageViews)} page views</p>
            <div className={dash.budgetPill}>
              <strong>{marketingShare === null ? '0%' : `${Math.round(marketingShare * 100)}%`}</strong>
              <span>from LinkedIn and email</span>
            </div>
            <div className={dash.rule} />
            <div className={dash.paceCopy}>
              <div className={dash.paceIcon} aria-hidden="true">{change === null ? '·' : change.pct >= 0 ? '↑' : '↓'}</div>
              <div>
                <strong>
                  {change === null
                    ? `${formatCount(fromMarketing)} visitors from marketing`
                    : `${Math.abs(change.pct)}% ${change.pct >= 0 ? 'more' : 'fewer'} visitors than ${change.versus}`}
                </strong>
                <span>LinkedIn {formatCount(web.fromLinkedIn)}, Mailchimp {formatCount(web.fromMailchimp)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className={dash.chartArea}>
          <div className={dash.legend}>
            <span><i className={dash.legLine} />Visitors each week</span>
            <span><i className={dash.legDash} />From LinkedIn and email</span>
          </div>
          <div className={dash.mainChartWrap}>
            {series.labels.length === 0 ? (
              <p className={mkt.chartEmpty}>Website numbers will appear here after the first update from Vercel.</p>
            ) : (
              <Line
                aria-label="Website visitors each week"
                role="img"
                data={{
                  labels: series.labels,
                  datasets: [
                    { label: 'Visitors', data: series.visitors, borderColor: MINERAL, backgroundColor: 'transparent', tension: 0.32, borderWidth: 3, pointRadius: series.labels.length === 1 ? 4 : 0, pointBackgroundColor: MINERAL },
                    { label: 'From LinkedIn and email', data: series.fromMarketing, borderColor: ZEST, borderDash: [4, 5], tension: 0.32, borderWidth: 2, pointRadius: series.labels.length === 1 ? 4 : 0, pointBackgroundColor: ZEST },
                  ],
                }}
                options={{ ...chartDefaults, scales: bigScales }}
              />
            )}
          </div>
        </div>

        <aside className={dash.sideSummary}>
          <div>
            <small>Top page</small>
            <strong className={mkt.sidePath}>{web.topPage ? web.topPage.path : 'None yet'}</strong>
            <span>{web.topPage ? `${formatCount(web.topPage.views)} views` : 'No visits yet'}</span>
          </div>
          <div className={dash.sideRule} />
          <div>
            <small>Enquiries</small>
            <strong>{formatCount(emailTotals.enquiries)}</strong>
            <span>website form, from campaigns</span>
          </div>
        </aside>
      </section>

      <div className={mkt.accountRow}>
        <span className={mkt.accountLabel}>LinkedIn account</span>
        {accountFilter}
      </div>

      {/* FOUR CARDS */}
      <section className={`${dash.bottomGrid} ${mkt.cardGrid}`}>
        <EmailCard campaigns={campaigns} totals={emailTotals} />
        <ResponsesCard totals={emailTotals} series={monthlyResponses(allCampaigns, months, month)} />
        <PostsCard posts={posts} totals={linkedin} account={account} />
        <FollowersCard totals={linkedin} series={followerSeries(followers, months, month)} account={account} />
      </section>
    </>
  )
}

function CardHead({ icon, title }) {
  return (
    <div className={dash.metricHead}>
      <div className={dash.icon} aria-hidden="true">{icon}</div>
      <h3 className={dash.metricTitle}>{title}</h3>
    </div>
  )
}

function ChartWell({ empty, label, children }) {
  return (
    <div className={`${dash.smallChartWrap} ${mkt.smallChart}`} role="img" aria-label={label}>
      {empty ? <p className={mkt.chartEmpty}>{empty}</p> : children}
    </div>
  )
}

function EmailCard({ campaigns, totals }) {
  const series = campaignSeries(campaigns)
  return (
    <article className={`${dash.card} ${dash.metricCard} ${mkt.metricCard}`}>
      <CardHead icon={<MailIcon />} title="Email campaigns" />
      <div className={dash.metricMain}>
        <div>
          <div className={dash.metricNumber}>{formatPercent(totals.avgOpenRate)}</div>
          <div className={dash.targetLine}>average open rate, <em>{totals.campaigns}</em> {totals.campaigns === 1 ? 'campaign' : 'campaigns'}</div>
        </div>
        <div className={dash.miniPct}><strong>{formatPercent(totals.avgClickRate)}</strong>click rate</div>
      </div>
      <div className={dash.paceRow}>
        <span>Click-to-open {formatPercent(totals.avgClickToOpen)}</span>
        <span>Replies {formatCount(totals.replies)}</span>
      </div>
      <ChartWell label="Open rate for each campaign" empty={series.labels.length === 0 ? 'No campaigns this period' : null}>
        <Bar
          data={{ labels: series.labels, datasets: [{ label: 'Open rate %', data: series.openRates, backgroundColor: MINERAL, borderRadius: 0, maxBarThickness: 28 }] }}
          options={{
            ...chartDefaults,
            plugins: { ...chartDefaults.plugins, tooltip: { callbacks: { label: ctx => `Open rate: ${ctx.raw}%` } } },
            scales: { ...smallScales, x: { ...smallScales.x, ticks: { display: false } }, y: { ...smallScales.y, ticks: { ...smallScales.y.ticks, callback: v => `${v}%` } } },
          }}
        />
      </ChartWell>
    </article>
  )
}

function ResponsesCard({ totals, series }) {
  const hasAny = series.enquiries.some(v => v > 0) || series.replies.some(v => v > 0)
  return (
    <article className={`${dash.card} ${dash.metricCard} ${mkt.metricCard}`}>
      <CardHead icon={<InboxIcon />} title="Enquiries and replies" />
      <div className={dash.metricMain}>
        <div>
          <div className={dash.metricNumber}>{formatCount(totals.enquiries)}</div>
          <div className={dash.targetLine}>website enquiries from email</div>
        </div>
        <div className={dash.miniPct}><strong>{formatCount(totals.replies)}</strong>replies</div>
      </div>
      <div className={dash.paceRow}>
        <span><i className={mkt.keyMineral} /> Enquiries</span>
        <span><i className={mkt.keyZest} /> Replies</span>
      </div>
      <ChartWell label="Enquiries and replies each month" empty={hasAny ? null : 'Typed in on each campaign below'}>
        <Bar
          data={{
            labels: series.labels,
            datasets: [
              { label: 'Enquiries', data: series.enquiries, backgroundColor: MINERAL, borderRadius: 0, maxBarThickness: 18 },
              { label: 'Replies', data: series.replies, backgroundColor: ZEST, borderRadius: 0, maxBarThickness: 18 },
            ],
          }}
          options={{ ...chartDefaults, scales: smallScales }}
        />
      </ChartWell>
    </article>
  )
}

function PostsCard({ posts, totals, account }) {
  const series = postSeries(posts)
  const split = account === 'both'
    ? `Spoke ${totals.postsByAccount.spoke}, Ed ${totals.postsByAccount.ed}`
    : ACCOUNT_LABELS[account]
  return (
    <article className={`${dash.card} ${dash.metricCard} ${mkt.metricCard}`}>
      <CardHead icon={<ChatIcon />} title="LinkedIn posts" />
      <div className={dash.metricMain}>
        <div>
          <div className={dash.metricNumber}>{formatCount(totals.posts)}</div>
          <div className={dash.targetLine}>posts, <em>{split}</em></div>
        </div>
        <div className={dash.miniPct}><strong>{totals.avgLikes === null ? '0' : formatDecimal(totals.avgLikes)}</strong>likes / post</div>
      </div>
      <div className={dash.paceRow}>
        <span>{formatCount(totals.likes)} likes</span>
        <span>{formatCount(totals.comments)} comments</span>
      </div>
      <ChartWell label="Likes on each post" empty={series.labels.length === 0 ? 'No posts logged this period' : null}>
        <Bar
          data={{ labels: series.labels, datasets: [{ label: 'Likes', data: series.likes, backgroundColor: MINERAL, borderRadius: 0, maxBarThickness: 18 }] }}
          options={{ ...chartDefaults, scales: smallScales }}
        />
      </ChartWell>
    </article>
  )
}

function FollowersCard({ totals, series, account }) {
  const accounts = Object.keys(totals.followers)
  const hasAny = accounts.some(a => series[a].some(v => v !== null))
  return (
    <article className={`${dash.card} ${dash.metricCard} ${mkt.metricCard}`}>
      <CardHead icon={<PeopleIcon />} title="LinkedIn followers" />
      <div className={mkt.followerRows}>
        {accounts.map(a => {
          const f = totals.followers[a]
          return (
            <div key={a} className={mkt.followerRow}>
              <div>
                <div className={`${dash.metricNumber} ${mkt.followerNumber}`}>{f ? formatCount(f.followers) : '0'}</div>
                <div className={dash.targetLine}>
                  <i className={a === 'spoke' ? mkt.keyMineral : mkt.keyZest} /> {ACCOUNT_LABELS[a]}
                  {f ? `, ${shortMonthLabel(monthOfDate(f.month))}` : ''}
                </div>
              </div>
              <div className={dash.miniPct}><strong>{f ? formatChange(f.change) : 'None'}</strong>{f && f.change !== null ? 'this month' : 'yet'}</div>
            </div>
          )
        })}
      </div>
      <ChartWell label="Followers each month" empty={hasAny ? null : 'Log a count below each month'}>
        <Line
          data={{
            labels: series.labels,
            datasets: accounts.map(a => ({
              label: ACCOUNT_LABELS[a],
              data: series[a],
              borderColor: a === 'spoke' ? MINERAL : ZEST,
              backgroundColor: a === 'spoke' ? MINERAL : ZEST,
              borderWidth: 2.5,
              tension: 0.3,
              pointRadius: 3,
              spanGaps: true,
            })),
          }}
          options={{ ...chartDefaults, scales: { ...smallScales, y: { ...smallScales.y, min: undefined } } }}
        />
      </ChartWell>
      {account !== 'both' && <span className={mkt.cardFoot}>Showing {ACCOUNT_LABELS[account]} only</span>}
    </article>
  )
}

const svg = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const MailIcon = () => (<svg {...svg}><rect x="2" y="4" width="20" height="16" rx="0" /><path d="m22 6-10 7L2 6" /></svg>)
const InboxIcon = () => (<svg {...svg}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></svg>)
const ChatIcon = () => (<svg {...svg}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>)
const PeopleIcon = () => (<svg {...svg}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>)
