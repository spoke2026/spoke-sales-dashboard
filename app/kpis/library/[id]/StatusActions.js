'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { canTransition } from '@/lib/kpi/library'
import { callApi, describeError } from '@/lib/kpi/clientApi'
import styles from '../../kpis.module.css'

// StatusActions ('use client'): the admin-only Publish/Retire controls on a
// current KPI's detail page. At most one confirm is open at a time. The Edit
// link (a link, because it navigates) shares the row when editHref is set.
export default function StatusActions({ id, version, status, editHref }) {
  const router = useRouter()
  const [openConfirm, setOpenConfirm] = useState(null) // null | 'publish' | 'retire'
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [alertMsg, setAlertMsg] = useState('')
  const [refreshing, startRefresh] = useTransition()

  const inFlight = useRef(false)
  const publishBtnRef = useRef(null)
  const retireBtnRef = useRef(null)
  const cancelRef = useRef(null)
  const keepItRef = useRef(null)
  const statusRef = useRef(null)
  // The opener is unmounted while its confirm is open, so focus goes back to
  // it after the re-render that brings it back, not in the click handler.
  const returnFocus = useRef(null)

  useEffect(() => {
    if (openConfirm === 'publish' && cancelRef.current) cancelRef.current.focus()
    if (openConfirm === 'retire' && keepItRef.current) keepItRef.current.focus()
    if (openConfirm === null && returnFocus.current !== null) {
      const target = returnFocus.current === 'publish' ? publishBtnRef.current : retireBtnRef.current
      returnFocus.current = null
      if (target) target.focus()
    }
  }, [openConfirm])

  // Focus the success message once the refreshed page has rendered, so the
  // re-render cannot take focus away from it.
  useEffect(() => {
    if (statusMsg !== '' && !refreshing && statusRef.current) statusRef.current.focus()
  }, [statusMsg, refreshing])

  function openPublish() {
    setAlertMsg('')
    setOpenConfirm('publish')
  }

  function openRetire() {
    setAlertMsg('')
    setOpenConfirm('retire')
  }

  function closeConfirm(opener) {
    returnFocus.current = opener
    setOpenConfirm(null)
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (openConfirm === 'publish') closeConfirm('publish')
      if (openConfirm === 'retire') closeConfirm('retire')
    }
  }

  async function handleConfirm(nextStatus) {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setAlertMsg('')

    const { status: httpStatus, json } = await callApi('/api/kpi/definitions/status', 'PATCH', {
      id,
      version,
      status: nextStatus,
    })

    inFlight.current = false
    setSaving(false)

    if (httpStatus === 200) {
      setOpenConfirm(null)
      setStatusMsg(nextStatus === 'published' ? 'KPI published.' : 'KPI retired.')
      startRefresh(() => router.refresh())
      return
    }

    const outcome = describeError(httpStatus, json, [])
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    setAlertMsg(outcome.alert)
  }

  const canPublish = canTransition(status, 'published')
  const canRetire = canTransition(status, 'retired')

  // Once retired there is nothing left to do, but the success message must
  // still be shown and announced.
  return (
    <div onKeyDown={handleKeyDown}>
      <p className={styles.statusMsg} role="status" tabIndex={-1} ref={statusRef}>{statusMsg}</p>
      {alertMsg && <p className={styles.formAlert} role="alert">{alertMsg}</p>}

      {(editHref !== null || canPublish || canRetire) && <div className={styles.actionsRow}>
        {editHref !== null && (
          <Link href={editHref} className={styles.manageLink}>
            Edit KPI
          </Link>
        )}
        {canPublish && openConfirm !== 'publish' && (
          <button type="button" ref={publishBtnRef} className={styles.btnSecondary} onClick={openPublish}>
            Publish KPI
          </button>
        )}
        {canRetire && openConfirm !== 'retire' && (
          <button type="button" ref={retireBtnRef} className={styles.btnSecondary} onClick={openRetire}>
            Retire KPI
          </button>
        )}
      </div>}

      {openConfirm === 'publish' && (
        <div className={styles.confirmRow}>
          <p className={styles.confirmText}>Publish this KPI? It becomes available for new scorecards.</p>
          <div className={styles.confirmActions}>
            <button type="button" ref={cancelRef} className={styles.btnSecondary} onClick={() => closeConfirm('publish')}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={saving}
              aria-busy={saving}
              onClick={() => handleConfirm('published')}
            >
              {saving ? 'Saving' : 'Publish KPI'}
            </button>
          </div>
        </div>
      )}

      {openConfirm === 'retire' && (
        <div className={styles.confirmRow}>
          <p className={styles.confirmText}>
            Retire this KPI? It stays on past scorecards but can&apos;t be added to new ones. You
            can&apos;t undo this here.
          </p>
          <div className={styles.confirmActions}>
            <button type="button" ref={keepItRef} className={styles.btnSecondary} onClick={() => closeConfirm('retire')}>
              Keep it
            </button>
            <button
              type="button"
              className={styles.btnDanger}
              disabled={saving}
              aria-busy={saving}
              onClick={() => handleConfirm('retired')}
            >
              {saving ? 'Saving' : 'Retire KPI'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
