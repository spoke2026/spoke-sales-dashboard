'use client'

import { useState } from 'react'
import { mondayOf } from '@/lib/marketing/months'
import { weeksInMonth, webTotals } from '@/lib/marketing/totals'
import { formatCount, formatDate } from '@/lib/marketing/format'
import { formatPairs, parsePairs } from '@/lib/marketing/validate'
import { todayInAuckland } from '@/lib/kpi/calendar'
import { DeleteButton, Field, FormActions, Stat, SyncNote, useWriter } from './shared'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

export default function WebsiteSection({ weeks, month, isAdmin, sync }) {
  const [form, setForm] = useState(null) // null | { week? }
  const rows = weeksInMonth(weeks, month)
  const totals = webTotals(rows)
  const thisWeek = mondayOf(todayInAuckland())

  return (
    <section className={styles.card} aria-labelledby="website-title">
      <div className={`${styles.cardHeader} ${mkt.cardHeaderWrap}`}>
        <div>
          <h2 id="website-title" className={styles.sectionTitle}>Website</h2>
          <p className={mkt.sectionMeta}>
            From Vercel Web Analytics, updated automatically. This week is a running total until Sunday. A week
            counts in the month its Monday falls in.
          </p>
          <SyncNote label="Vercel" status={sync} />
        </div>
        {isAdmin && form === null && (
          <button type="button" className={styles.btnSecondary} onClick={() => setForm({})}>
            Add a week by hand
          </button>
        )}
      </div>
      {isAdmin && form !== null && (
        <p className={styles.helper}>
          Vercel replaces this week and last week each time it updates, so only type in weeks it doesn&apos;t have.
        </p>
      )}

      <div className={styles.statsRow}>
        <Stat value={formatCount(totals.visitors)} label="Visitors" />
        <Stat value={formatCount(totals.pageViews)} label="Page views" />
        <Stat value={formatCount(totals.fromLinkedIn)} label="Visitors from LinkedIn" />
        <Stat value={formatCount(totals.fromMailchimp)} label="Visitors from Mailchimp" />
        <Stat
          value={totals.topPage ? totals.topPage.path : 'None yet'}
          label="Top page"
          note={totals.topPage ? `${formatCount(totals.topPage.views)} views` : null}
        />
      </div>

      {form !== null && <WeekForm week={form.week} onDone={() => setForm(null)} />}

      {rows.length === 0 ? (
        <p className={styles.emptyState}>No website numbers for this period yet.</p>
      ) : (
        <div className={`${styles.tableWrap} ${mkt.tableScroll}`} role="region" tabIndex={0} aria-label="Website weeks table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>Website numbers by week</caption>
            <thead>
              <tr>
                <th scope="col">Week starting</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Visitors</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Page views</th>
                <th scope="col">Top pages</th>
                <th scope="col">Top referrers</th>
                {isAdmin && <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(w => (
                <tr key={w.id} className={mkt.topAlign}>
                  <td>
                    {formatDate(w.week_start)}
                    {w.week_start === thisWeek && <span className={mkt.rowNote}>So far</span>}
                    {w.source === 'manual' && <span className={mkt.rowNote}>Typed in</span>}
                  </td>
                  <td className={styles.numCell}>{formatCount(w.visitors)}</td>
                  <td className={styles.numCell}>{formatCount(w.page_views)}</td>
                  <td><PairList items={w.top_pages} keyName="path" numName="views" /></td>
                  <td><PairList items={w.top_referrers} keyName="site" numName="visitors" /></td>
                  {isAdmin && (
                    <td>
                      <span className={mkt.rowActions}>
                        <button type="button" className={styles.rowBtn} onClick={() => setForm({ week: w })}>
                          Edit<span className={styles.visuallyHidden}> week starting {formatDate(w.week_start)}</span>
                        </button>
                        <DeleteWeek week={w} />
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function PairList({ items, keyName, numName }) {
  if (!items || items.length === 0) return <span className={styles.helper}>None</span>
  return (
    <ul className={mkt.pairList}>
      {items.map((item, i) => (
        <li key={`${item[keyName]}-${i}`}>
          <span>{item[keyName]}</span> <span className={styles.mono}>{formatCount(item[numName])}</span>
        </li>
      ))}
    </ul>
  )
}

function DeleteWeek({ week }) {
  const { write } = useWriter()
  return (
    <DeleteButton
      label={`week starting ${formatDate(week.week_start)}`}
      onConfirm={() => write('/api/marketing/web-weeks', 'DELETE', { id: week.id })}
    />
  )
}

const WEEK_FIELDS = ['week_start', 'visitors', 'page_views', 'top_pages', 'top_referrers']

function WeekForm({ week, onDone }) {
  const [values, setValues] = useState({
    week_start: week?.week_start ?? mondayOf(todayInAuckland()),
    visitors: String(week?.visitors ?? ''),
    page_views: String(week?.page_views ?? ''),
    top_pages: formatPairs(week?.top_pages, 'path', 'views'),
    top_referrers: formatPairs(week?.top_referrers, 'site', 'visitors'),
  })
  const [errors, setErrors] = useState({})
  const [alert, setAlert] = useState('')
  const { write, busy } = useWriter()

  const set = key => e => setValues(v => ({ ...v, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setErrors({})
    setAlert('')
    const pages = parsePairs(values.top_pages, 'path', 'views')
    const referrers = parsePairs(values.top_referrers, 'site', 'visitors')
    if (pages.error || referrers.error) {
      setErrors({
        ...(pages.error ? { top_pages: pages.error } : {}),
        ...(referrers.error ? { top_referrers: referrers.error } : {}),
      })
      return
    }
    const body = {
      ...(week ? { id: week.id } : {}),
      week_start: values.week_start,
      visitors: values.visitors,
      page_views: values.page_views,
      top_pages: pages.value,
      top_referrers: referrers.value,
    }
    const result = await write('/api/marketing/web-weeks', week ? 'PATCH' : 'POST', body, WEEK_FIELDS)
    if (result.ok) onDone()
    else if (result.field) setErrors({ [result.field]: result.message })
    else setAlert(result.message || "We couldn't save that. Try again.")
  }

  return (
    <form className={`${styles.form} ${mkt.formGrid}`} onSubmit={handleSubmit} noValidate>
      <Field id="week-start" label="Week starting (Monday)" error={errors.week_start}>
        <input id="week-start" type="date" className={styles.input} value={values.week_start} onChange={set('week_start')}
          aria-invalid={errors.week_start ? 'true' : undefined} required />
      </Field>
      <Field id="week-visitors" label="Visitors" error={errors.visitors}>
        <input id="week-visitors" inputMode="numeric" className={styles.input} value={values.visitors} onChange={set('visitors')}
          aria-invalid={errors.visitors ? 'true' : undefined} required />
      </Field>
      <Field id="week-views" label="Page views" error={errors.page_views}>
        <input id="week-views" inputMode="numeric" className={styles.input} value={values.page_views} onChange={set('page_views')}
          aria-invalid={errors.page_views ? 'true' : undefined} required />
      </Field>
      <div className={mkt.spanAll}>
        <Field id="week-pages" label="Top pages" helper='One per line: the page then its views, like "/contact 42".' error={errors.top_pages}>
          <textarea id="week-pages" className={styles.textareaMono} value={values.top_pages} onChange={set('top_pages')}
            aria-describedby="week-pages-help" aria-invalid={errors.top_pages ? 'true' : undefined} />
        </Field>
      </div>
      <div className={mkt.spanAll}>
        <Field id="week-referrers" label="Top referrers" helper='One per line: the site then its visitors, like "linkedin.com 12".' error={errors.top_referrers}>
          <textarea id="week-referrers" className={styles.textareaMono} value={values.top_referrers} onChange={set('top_referrers')}
            aria-describedby="week-referrers-help" aria-invalid={errors.top_referrers ? 'true' : undefined} />
        </Field>
      </div>
      {alert && <p className={`${styles.formAlert} ${mkt.spanAll}`} role="alert">{alert}</p>}
      <div className={mkt.spanAll}>
        <FormActions busy={busy} onCancel={onDone} saveLabel={week ? 'Save changes' : 'Add week'} />
      </div>
    </form>
  )
}
