'use client'

import { useState } from 'react'
import { campaignsInMonth, emailTotals } from '@/lib/marketing/totals'
import { formatCount, formatPercent, formatSendDate } from '@/lib/marketing/format'
import { toCount } from '@/lib/marketing/validate'
import { Stat, SyncNote, useWriter } from './shared'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

export default function EmailSection({ campaigns, month, isAdmin, sync }) {
  const rows = campaignsInMonth(campaigns, month)
  const totals = emailTotals(rows)

  return (
    <section className={styles.card} aria-labelledby="email-title">
      <div className={`${styles.cardHeader} ${mkt.cardHeaderWrap}`}>
        <div>
          <h2 id="email-title" className={styles.sectionTitle}>Email</h2>
          <p className={mkt.sectionMeta}>From Mailchimp. Replies and enquiries are typed in.</p>
          <SyncNote label="Mailchimp" status={sync} />
        </div>
      </div>

      <div className={styles.statsRow}>
        <Stat value={formatCount(totals.campaigns)} label="Campaigns sent" />
        <Stat value={formatPercent(totals.avgOpenRate)} label="Average open rate" />
        <Stat value={formatPercent(totals.avgClickRate)} label="Average click rate" />
        <Stat value={formatPercent(totals.avgClickToOpen)} label="Average click-to-open" />
        <Stat value={formatCount(totals.replies)} label="Replies" />
        <Stat value={formatCount(totals.enquiries)} label="Enquiries" />
      </div>

      {rows.length === 0 ? (
        <p className={styles.emptyState}>No campaigns sent in this period.</p>
      ) : (
        <div className={`${styles.tableWrap} ${mkt.tableScroll}`} role="region" tabIndex={0} aria-label="Email campaigns table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>Email campaigns</caption>
            <thead>
              <tr>
                <th scope="col">Sent</th>
                <th scope="col">Campaign</th>
                <th scope="col">Subject line</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Recipients</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Opens</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Open rate</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Clicks</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Click rate</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Click-to-open</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Replies</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Enquiries</th>
                {isAdmin && <th scope="col"><span className={styles.visuallyHidden}>Save</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <CampaignRow key={c.id} campaign={c} isAdmin={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CampaignRow({ campaign: c, isAdmin }) {
  const [replies, setReplies] = useState(String(c.replies))
  const [enquiries, setEnquiries] = useState(String(c.enquiries))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const { write, busy } = useWriter()

  const dirty = replies !== String(c.replies) || enquiries !== String(c.enquiries)
  const repliesId = `replies-${c.id}`
  const enquiriesId = `enquiries-${c.id}`

  async function handleSave() {
    setSaved('')
    if (toCount(replies) === null || toCount(enquiries) === null) {
      setError('Use whole numbers, 0 or more.')
      return
    }
    const result = await write('/api/marketing/campaigns', 'PATCH', { id: c.id, replies, enquiries }, ['replies', 'enquiries'])
    if (result.ok) {
      setError('')
      setSaved('Saved')
    } else {
      setError(result.message || "We couldn't save that. Try again.")
    }
  }

  return (
    <tr>
      <td>{formatSendDate(c.send_time)}</td>
      <td className={mkt.wrapCell}>{c.campaign_name}</td>
      <td className={mkt.wrapCell}>{c.subject_line}</td>
      <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(c.recipients)}</td>
      <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(c.unique_opens)}</td>
      <td className={`${styles.numCell} ${mkt.numHead}`}>{formatPercent(c.open_rate)}</td>
      <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(c.unique_clicks)}</td>
      <td className={`${styles.numCell} ${mkt.numHead}`}>{formatPercent(c.click_rate)}</td>
      <td className={`${styles.numCell} ${mkt.numHead}`}>{formatPercent(c.click_to_open)}</td>
      {isAdmin ? (
        <>
          <td className={`${styles.numCell} ${mkt.numHead}`}>
            <label htmlFor={repliesId} className={styles.visuallyHidden}>Replies to {c.campaign_name}</label>
            <input
              id={repliesId}
              className={`${styles.cellInput} ${mkt.smallInput}`}
              inputMode="numeric"
              value={replies}
              onChange={e => setReplies(e.target.value)}
            />
          </td>
          <td className={`${styles.numCell} ${mkt.numHead}`}>
            <label htmlFor={enquiriesId} className={styles.visuallyHidden}>Enquiries from {c.campaign_name}</label>
            <input
              id={enquiriesId}
              className={`${styles.cellInput} ${mkt.smallInput}`}
              inputMode="numeric"
              value={enquiries}
              onChange={e => setEnquiries(e.target.value)}
            />
          </td>
          <td>
            <button type="button" className={styles.rowBtn} onClick={handleSave} disabled={busy || !dirty}>
              {busy ? 'Saving' : 'Save'}
            </button>
            <span className={mkt.rowStatus} role="status">{saved && !dirty ? saved : ''}</span>
            {error && <span className={styles.fieldError} role="alert"> {error}</span>}
          </td>
        </>
      ) : (
        <>
          <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(c.replies)}</td>
          <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(c.enquiries)}</td>
        </>
      )}
    </tr>
  )
}
