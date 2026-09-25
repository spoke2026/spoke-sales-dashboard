'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { callApi, describeError } from '@/lib/kpi/clientApi'
import styles from '../kpis.module.css'

// StartScorecardButton ('use client'): starts a company or individual
// scorecard for the chosen quarter, then navigates straight to the builder.
export default function StartScorecardButton({ personId, fy, quarter, label, hiddenSuffix }) {
  const router = useRouter()
  const [starting, setStarting] = useState(false)
  const [alertMsg, setAlertMsg] = useState('')
  const inFlight = useRef(false)

  async function handleClick() {
    if (inFlight.current) return
    inFlight.current = true
    setStarting(true)
    setAlertMsg('')

    const { status, json } = await callApi('/api/kpi/scorecards', 'POST', { personId, fy, quarter })

    if (status === 201) {
      router.push(`/kpis/scorecards/${json.scorecard.id}?notice=started`)
      return
    }

    inFlight.current = false
    setStarting(false)

    const outcome = describeError(status, json, [])
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    setAlertMsg(outcome.alert)
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.btnSecondary} ${styles.rowBtn}`}
        disabled={starting}
        aria-busy={starting}
        onClick={handleClick}
      >
        {starting ? 'Starting' : label}
        {hiddenSuffix ? <span className={styles.visuallyHidden}>{hiddenSuffix}</span> : null}
      </button>
      {alertMsg && <p className={styles.formAlert} role="alert">{alertMsg}</p>}
    </>
  )
}
