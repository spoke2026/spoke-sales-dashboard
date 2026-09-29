'use client'

import { useState } from 'react'
import { ALL_MONTHS, monthOfDate, shortMonthLabel } from '@/lib/marketing/months'
import { ACCOUNT_LABELS, followerRowsWithChange, postsInView } from '@/lib/marketing/totals'
import { formatChange, formatCount, formatDate } from '@/lib/marketing/format'
import { todayInAuckland } from '@/lib/kpi/calendar'
import { DeleteButton, Field, FormActions, Panel, useWriter } from './shared'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

export default function LinkedInSection({ posts, followers, month, months, account, isAdmin }) {
  const [form, setForm] = useState(null) // null | { kind: 'post', post? } | { kind: 'followers' }

  const shownPosts = postsInView(posts, month, account)
  const followerRows = followerRowsWithChange(followers)
  const shownFollowers = followerRows.filter(
    r => (account === 'both' || r.account === account) &&
      (month === ALL_MONTHS || monthOfDate(r.month) === month)
  )

  return (
    <Panel
      title="LinkedIn posts and followers"
      count={`${shownPosts.length} ${shownPosts.length === 1 ? 'post' : 'posts'}`}
      hint={isAdmin ? 'Add posts and log followers here' : null}
    >
      <p className={mkt.sectionMeta}>Typed in by hand. The account filter above applies here too.</p>

      {/* ── Posts ── */}
      <div className={mkt.subHeader}>
        <h3 className={mkt.subTitle}>Posts</h3>
        {isAdmin && form === null && (
          <button type="button" className={styles.btnSecondary} onClick={() => setForm({ kind: 'post' })}>
            Add post
          </button>
        )}
      </div>

      {form?.kind === 'post' && (
        <PostForm post={form.post} onDone={() => setForm(null)} />
      )}

      {shownPosts.length === 0 ? (
        <p className={styles.emptyState}>No posts logged for this period.</p>
      ) : (
        <div className={`${styles.tableWrap} ${mkt.tableScroll}`} role="region" tabIndex={0} aria-label="LinkedIn posts table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>LinkedIn posts</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Account</th>
                <th scope="col">What it was about</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Likes</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Comments</th>
                <th scope="col">Link</th>
                {isAdmin && <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {shownPosts.map(p => (
                <tr key={p.id}>
                  <td>{formatDate(p.posted_on)}</td>
                  <td>{ACCOUNT_LABELS[p.account]}</td>
                  <td className={mkt.wrapCell}>{p.topic}</td>
                  <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(p.likes)}</td>
                  <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(p.comments)}</td>
                  <td>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className={mkt.textLink}>
                        Open<span className={styles.visuallyHidden}> post from {formatDate(p.posted_on)}</span>
                      </a>
                    ) : ''}
                  </td>
                  {isAdmin && (
                    <td>
                      <RowActions
                        label={`post from ${formatDate(p.posted_on)}`}
                        onEdit={() => setForm({ kind: 'post', post: p })}
                        deleteUrl="/api/marketing/posts"
                        id={p.id}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Followers ── */}
      <div className={mkt.subHeader}>
        <h3 className={mkt.subTitle}>Followers</h3>
        {isAdmin && form === null && (
          <button type="button" className={styles.btnSecondary} onClick={() => setForm({ kind: 'followers' })}>
            Log followers
          </button>
        )}
      </div>

      {form?.kind === 'followers' && (
        <FollowerForm months={months} month={month} onDone={() => setForm(null)} />
      )}

      {shownFollowers.length === 0 ? (
        <p className={styles.emptyState}>No follower counts logged for this period.</p>
      ) : (
        <div className={`${styles.tableWrap} ${mkt.tableScroll}`} role="region" tabIndex={0} aria-label="LinkedIn followers table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>LinkedIn followers by month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Account</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Followers</th>
                <th scope="col" className={`${styles.numCell} ${mkt.numHead}`}>Change</th>
                {isAdmin && <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {shownFollowers.map(r => (
                <tr key={r.id}>
                  <td>{shortMonthLabel(monthOfDate(r.month))}</td>
                  <td>{ACCOUNT_LABELS[r.account]}</td>
                  <td className={`${styles.numCell} ${mkt.numHead}`}>{formatCount(r.followers)}</td>
                  <td className={`${styles.numCell} ${mkt.numHead}`}>{formatChange(r.change)}</td>
                  {isAdmin && (
                    <td>
                      <DeleteRow
                        label={`${ACCOUNT_LABELS[r.account]} count for ${shortMonthLabel(monthOfDate(r.month))}`}
                        url="/api/marketing/followers"
                        id={r.id}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && (
        <p className={styles.helper}>
          To correct a count, log it again for the same month and account. It replaces the old one.
        </p>
      )}
    </Panel>
  )
}

function DeleteRow({ label, url, id }) {
  const { write } = useWriter()
  return <DeleteButton label={label} onConfirm={() => write(url, 'DELETE', { id })} />
}

function RowActions({ label, onEdit, deleteUrl, id }) {
  return (
    <span className={mkt.rowActions}>
      <button type="button" className={styles.rowBtn} onClick={onEdit}>
        Edit<span className={styles.visuallyHidden}> {label}</span>
      </button>
      <DeleteRow label={label} url={deleteUrl} id={id} />
    </span>
  )
}

const POST_FIELDS = ['account', 'posted_on', 'topic', 'likes', 'comments', 'url']

function PostForm({ post, onDone }) {
  const [values, setValues] = useState({
    account: post?.account ?? 'spoke',
    posted_on: post?.posted_on ?? todayInAuckland(),
    topic: post?.topic ?? '',
    likes: String(post?.likes ?? 0),
    comments: String(post?.comments ?? 0),
    url: post?.url ?? '',
  })
  const [errors, setErrors] = useState({})
  const [alert, setAlert] = useState('')
  const { write, busy } = useWriter()

  const set = key => e => setValues(v => ({ ...v, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setErrors({})
    setAlert('')
    const body = { ...values, platform: 'linkedin', ...(post ? { id: post.id } : {}) }
    const result = await write('/api/marketing/posts', post ? 'PATCH' : 'POST', body, POST_FIELDS)
    if (result.ok) onDone()
    else if (result.field) setErrors({ [result.field]: result.message })
    else setAlert(result.message || "We couldn't save that. Try again.")
  }

  return (
    <form className={`${styles.form} ${mkt.formGrid}`} onSubmit={handleSubmit} noValidate>
      <Field id="post-account" label="Account" error={errors.account}>
        <select id="post-account" className={styles.select} value={values.account} onChange={set('account')}>
          <option value="spoke">Spoke company page</option>
          <option value="ed">Ed&apos;s profile</option>
        </select>
      </Field>
      <Field id="post-date" label="Date posted" error={errors.posted_on}>
        <input id="post-date" type="date" className={styles.input} value={values.posted_on} onChange={set('posted_on')}
          aria-invalid={errors.posted_on ? 'true' : undefined} required />
      </Field>
      <div className={mkt.spanAll}>
        <Field id="post-topic" label="What the post was about" error={errors.topic}>
          <input id="post-topic" className={styles.input} value={values.topic} onChange={set('topic')} maxLength={500}
            aria-invalid={errors.topic ? 'true' : undefined} required />
        </Field>
      </div>
      <Field id="post-likes" label="Likes" error={errors.likes}>
        <input id="post-likes" inputMode="numeric" className={styles.input} value={values.likes} onChange={set('likes')}
          aria-invalid={errors.likes ? 'true' : undefined} />
      </Field>
      <Field id="post-comments" label="Comments" error={errors.comments}>
        <input id="post-comments" inputMode="numeric" className={styles.input} value={values.comments} onChange={set('comments')}
          aria-invalid={errors.comments ? 'true' : undefined} />
      </Field>
      <div className={mkt.spanAll}>
        <Field id="post-url" label="Link (optional)" error={errors.url}>
          <input id="post-url" type="url" className={styles.input} value={values.url} onChange={set('url')}
            placeholder="https://www.linkedin.com/posts/..." aria-invalid={errors.url ? 'true' : undefined} />
        </Field>
      </div>
      {alert && <p className={`${styles.formAlert} ${mkt.spanAll}`} role="alert">{alert}</p>}
      <div className={mkt.spanAll}>
        <FormActions busy={busy} onCancel={onDone} saveLabel={post ? 'Save changes' : 'Add post'} />
      </div>
    </form>
  )
}

function FollowerForm({ months, month, onDone }) {
  const [values, setValues] = useState({
    account: 'spoke',
    month: month === ALL_MONTHS ? months[months.length - 1] : month,
    followers: '',
  })
  const [errors, setErrors] = useState({})
  const [alert, setAlert] = useState('')
  const { write, busy } = useWriter()

  const set = key => e => setValues(v => ({ ...v, [key]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setErrors({})
    setAlert('')
    const result = await write('/api/marketing/followers', 'POST', { ...values, platform: 'linkedin' }, ['account', 'month', 'followers'])
    if (result.ok) onDone()
    else if (result.field) setErrors({ [result.field]: result.message })
    else setAlert(result.message || "We couldn't save that. Try again.")
  }

  return (
    <form className={`${styles.form} ${mkt.formGrid}`} onSubmit={handleSubmit} noValidate>
      <Field id="followers-account" label="Account" error={errors.account}>
        <select id="followers-account" className={styles.select} value={values.account} onChange={set('account')}>
          <option value="spoke">Spoke company page</option>
          <option value="ed">Ed&apos;s profile</option>
        </select>
      </Field>
      <Field id="followers-month" label="Month" error={errors.month}>
        <select id="followers-month" className={styles.select} value={values.month} onChange={set('month')}>
          {[...months].reverse().map(m => (
            <option key={m} value={m}>{shortMonthLabel(m)}</option>
          ))}
        </select>
      </Field>
      <Field id="followers-count" label="Followers" error={errors.followers}>
        <input id="followers-count" inputMode="numeric" className={styles.input} value={values.followers}
          onChange={set('followers')} aria-invalid={errors.followers ? 'true' : undefined} required />
      </Field>
      {alert && <p className={`${styles.formAlert} ${mkt.spanAll}`} role="alert">{alert}</p>}
      <div className={mkt.spanAll}>
        <FormActions busy={busy} onCancel={onDone} saveLabel="Save count" />
      </div>
    </form>
  )
}
