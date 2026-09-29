'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { callApi } from '@/lib/kpi/clientApi'
import { ALL_MONTHS, monthLabel, monthOptions, parseMonthParam } from '@/lib/marketing/months'
import KpiSignOut from '@/components/KpiSignOut'
import dash from '@/app/dashboard.module.css'
import mkt from './marketing.module.css'

const AUTO_REFRESH_MS = 15 * 60 * 1000
const SOURCES = ['mailchimp', 'vercel']

// Month selector for the Marketing tab, shared by the header and the mobile
// bar. Changing it keeps the other filters in the URL.
export function MonthSelect({ className, id }) {
  const router = useRouter()
  const params = useSearchParams()
  const months = monthOptions()
  const month = parseMonthParam(params.get('month'), months)

  function handleChange(e) {
    const next = new URLSearchParams(params)
    next.set('month', e.target.value)
    router.push(`/marketing?${next}`, { scroll: false })
  }

  return (
    <select id={id} className={className} value={month} onChange={handleChange} aria-label="Month">
      <option value={ALL_MONTHS}>All months</option>
      {[...months].reverse().map(m => (
        <option key={m} value={m}>{monthLabel(m)}</option>
      ))}
    </select>
  )
}

// Header controls, laid out like the Sales header: month, a quiet refresh,
// the sync indicator and Sign out. Mailchimp and Vercel refresh when the tab
// opens and every 15 minutes while it stays open; the server skips a source
// tried in the last 15 minutes. Per-source "Last updated" and any errors show
// on the page itself.
export default function HeaderControls() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const running = useRef(false)

  const refresh = useCallback(async auto => {
    if (running.current) return
    running.current = true
    setBusy(true)
    const { status, json } = await callApi('/api/marketing/sync', 'POST', { auto })
    running.current = false
    setBusy(false)
    if (status === 401) {
      window.location.assign('/login')
      return
    }
    setFailed(status !== 200 || SOURCES.some(s => json?.[s] && !json[s].ok))
    if (SOURCES.some(s => json?.[s] && !json[s].skipped)) router.refresh()
  }, [router])

  useEffect(() => {
    refresh(true)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh(true)
    }, AUTO_REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  return (
    <div className={`${dash.controls} ${mkt.headerControls}`}>
      <span className={mkt.headerOnly}>
        <MonthSelect />
      </span>
      <button type="button" className={`${dash.editBtn} ${mkt.headerOnly}`} onClick={() => refresh(false)} disabled={busy}>
        {busy ? 'Updating' : 'Refresh now'}
      </button>
      <div className={`${dash.sync} ${mkt.headerSync}`} role="status">
        <span>
          {busy ? 'Updating from Mailchimp and Vercel...' : failed ? 'Last update had a problem, see below' : 'Mailchimp and Vercel, every 15 min'}
        </span>
        <i className={`${dash.dot} ${busy ? dash.dotPulse : ''} ${failed && !busy ? mkt.dotBad : ''}`} />
      </div>
      <KpiSignOut />
    </div>
  )
}
