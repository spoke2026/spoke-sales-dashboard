'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callApi } from '@/lib/kpi/clientApi'
import styles from '@/app/kpis/kpis.module.css'
import mkt from './marketing.module.css'

const AUTO_REFRESH_MS = 15 * 60 * 1000
const SOURCES = [['mailchimp', 'Mailchimp'], ['vercel', 'Vercel']]

function summarise(json) {
  const failed = SOURCES.filter(([key]) => json?.[key] && !json[key].ok)
  if (failed.length > 0) return { error: failed.map(([key, label]) => `${label}: ${json[key].error}`).join(' ') }
  return { message: 'Numbers updated from Mailchimp and Vercel.' }
}

// Pulls fresh Mailchimp and Vercel numbers: on the button, when the tab opens,
// and every 15 minutes while it stays open. Automatic refreshes are skipped on
// the server when a source was tried in the last 15 minutes.
export default function RefreshControl() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const running = useRef(false)

  const refresh = useCallback(async auto => {
    if (running.current) return
    running.current = true
    setBusy(true)
    if (!auto) {
      setMessage('')
      setError('')
    }
    const { status, json } = await callApi('/api/marketing/sync', 'POST', { auto })
    running.current = false
    setBusy(false)
    if (status === 401) {
      window.location.assign('/login')
      return
    }
    const anyRan = SOURCES.some(([key]) => json?.[key] && !json[key].skipped)
    if (anyRan) router.refresh()
    // Automatic refreshes stay quiet; failures show in each section's note.
    if (auto) return
    if (status !== 200) {
      setError(json?.error || "The update didn't finish. Try again in a few minutes.")
      return
    }
    const result = summarise(json)
    setMessage(result.message || '')
    setError(result.error || '')
  }, [router])

  useEffect(() => {
    refresh(true)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh(true)
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className={mkt.refreshRow}>
      <span className={styles.helper}>
        Mailchimp and website numbers update by themselves every 15 minutes.
      </span>
      <button type="button" className={styles.btnSecondary} onClick={() => refresh(false)} disabled={busy}>
        {busy ? 'Updating' : 'Refresh now'}
      </button>
      <span className={mkt.syncStatus} role="status">{message}</span>
      {error && <span className={styles.fieldError} role="alert">{error}</span>}
    </div>
  )
}
