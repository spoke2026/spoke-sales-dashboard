'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { callApi, describeError } from '@/lib/kpi/clientApi'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

export function Stat({ value, label, note }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statValue} ${mkt.statValue}`}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {note && <span className={mkt.statNote}>{note}</span>}
    </div>
  )
}

// Link chips that set one query param and keep the others.
export function ChipFilter({ label, param, value, options, query }) {
  return (
    <nav aria-label={label}>
      <ul className={styles.chipRow}>
        {options.map(option => {
          const params = new URLSearchParams({ ...query, [param]: option.value })
          return (
            <li key={option.value}>
              <Link
                href={`/marketing?${params}`}
                scroll={false}
                className={styles.chip}
                aria-current={option.value === value ? 'true' : undefined}
              >
                {option.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// Sends one write to a Marketing API route, then refreshes the server data.
// Returns { ok } or { ok: false, field, message } for the form to show.
export function useWriter() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function write(url, method, body, fields = []) {
    setBusy(true)
    const { status, json } = await callApi(url, method, body)
    setBusy(false)
    if (status >= 200 && status < 300) {
      router.refresh()
      return { ok: true }
    }
    const described = describeError(status, json, fields)
    if (described.redirect) {
      window.location.assign('/login')
      return { ok: false }
    }
    return { ok: false, field: described.field, message: described.message || described.alert }
  }

  return { write, busy }
}

export function DeleteButton({ label, onConfirm }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!confirming) {
    return (
      <button type="button" className={styles.rowBtn} onClick={() => setConfirming(true)}>
        Delete<span className={styles.visuallyHidden}> {label}</span>
      </button>
    )
  }

  async function handleConfirm() {
    setBusy(true)
    const result = await onConfirm()
    setBusy(false)
    if (!result.ok) setError(result.message || "We couldn't delete that. Try again.")
  }

  return (
    <span className={mkt.inlineConfirm}>
      <span>Delete {label}?</span>
      <button type="button" className={`${styles.rowBtn} ${mkt.dangerBtn}`} onClick={handleConfirm} disabled={busy}>
        {busy ? 'Deleting' : 'Yes, delete'}
      </button>
      <button type="button" className={styles.rowBtn} onClick={() => setConfirming(false)} disabled={busy}>
        Keep
      </button>
      {error && <span className={styles.fieldError} role="alert">{error}</span>}
    </span>
  )
}

export function Field({ id, label, error, helper, children }) {
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      {helper && <span className={styles.helper} id={`${id}-help`}>{helper}</span>}
      {children}
      {error && <span className={styles.fieldError} id={`${id}-error`}>{error}</span>}
    </div>
  )
}

export function FormActions({ busy, onCancel, saveLabel = 'Save' }) {
  return (
    <div className={styles.formActions}>
      <button type="button" className={styles.btnSecondary} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className={styles.btnPrimary} disabled={busy}>
        {busy ? 'Saving' : saveLabel}
      </button>
    </div>
  )
}

// "Last updated" line for one sync source, with its last error if it failed.
export function SyncNote({ label, status }) {
  return (
    <p className={mkt.sectionMeta}>
      {status.lastUpdated ? `Last updated from ${label} ${status.lastUpdated}.` : `Not updated from ${label} yet.`}
      {status.lastError && (
        <span className={`${styles.fieldError} ${mkt.syncError}`} role="alert">
          The last {label} update failed: {status.lastError}
        </span>
      )}
    </p>
  )
}

// A fold-away detail panel under the dashboard cards. Closed by default so the
// dashboard stays the first thing people see.
export function Panel({ title, count, hint, children }) {
  return (
    <details className={`${styles.card} ${mkt.panel}`}>
      <summary className={mkt.panelSummary}>
        <h2 className={`${styles.sectionTitle} ${mkt.panelTitle}`}>{title}</h2>
        {count !== undefined && <span className={mkt.panelCount}>{count}</span>}
        {hint && <span className={mkt.panelHint}>{hint}</span>}
      </summary>
      <div className={mkt.panelBody}>{children}</div>
    </details>
  )
}
