'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callApi, describeError } from '@/lib/kpi/clientApi'
import styles from '../../kpis.module.css'

// ScorecardWorkspace ('use client'): the target grid, KPI add/remove, and the
// lifecycle actions for one scorecard. The page keys this component with the
// current target and assignment ids, so its state resets after every
// router.refresh() rather than carrying stale edits forward.
export default function ScorecardWorkspace({ scorecard, quarterLabel, actions, months, monthLabels, rows, addOptions, hasPublishedKpis }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()

  const initialValues = useMemo(() => {
    const map = {}
    for (const row of rows) {
      for (const cell of row.cells) map[cell.field] = cell.initial
    }
    return map
  }, [rows])

  // A signature of the server's current cell values. The page keeps this
  // component mounted across router.refresh() (so a success message can
  // still be shown and focused once the refresh settles, as in
  // StatusActions), but the grid's own edit state resets whenever the
  // server's data actually changes underneath it.
  const rowsSignature = useMemo(
    () => rows.map(r => `${r.assignmentId}:${r.cells.map(c => `${c.field}=${c.initial}`).join(',')}`).join('|'),
    [rows]
  )

  const [cellValues, setCellValues] = useState(initialValues)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formAlert, setFormAlert] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [exceptionMode, setExceptionMode] = useState(false)
  const [reasonText, setReasonText] = useState('')

  const [openLifecycle, setOpenLifecycle] = useState(null) // null | submit | return | approve | record_board_approval
  const [lifecycleNote, setLifecycleNote] = useState('')
  const [lifecycleDate, setLifecycleDate] = useState('')
  const [lifecycleSaving, setLifecycleSaving] = useState(false)

  const [removingId, setRemovingId] = useState(null)
  const [removeSaving, setRemoveSaving] = useState(false)

  const [addKpiId, setAddKpiId] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  const inFlight = useRef(false)
  const statusRef = useRef(null)
  const alertRef = useRef(null)
  const reasonRef = useRef(null)
  const inputRefs = useRef({})
  const removeOpenerRefs = useRef({})
  const keepItRef = useRef(null)
  const cancelRef = useRef(null)
  const dateRef = useRef(null)
  const noteRef = useRef(null)
  const returnFocusRemove = useRef(null)

  const canEdit = actions.includes('edit')
  const canException = actions.includes('exception_edit')
  const editable = canEdit || (canException && exceptionMode)

  const dirty = Object.keys(initialValues).some(field => (cellValues[field] ?? '') !== initialValues[field])

  useEffect(() => {
    if (statusMsg !== '' && !refreshing && statusRef.current) statusRef.current.focus()
  }, [statusMsg, refreshing])

  // Re-sync the grid's edit state from the server whenever its data actually
  // changes (a save, an add, a remove, or another user's edit landing via
  // refresh). Intentionally excludes statusMsg/formAlert so a success message
  // from the action that caused this refresh stays visible and focusable.
  useEffect(() => {
    setCellValues(initialValues)
    setFieldErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSignature])

  useEffect(() => {
    if (openLifecycle === 'submit' && cancelRef.current) cancelRef.current.focus()
    if (openLifecycle === 'approve' && cancelRef.current) cancelRef.current.focus()
  }, [openLifecycle])

  useEffect(() => {
    if (removingId !== null && keepItRef.current) keepItRef.current.focus()
    if (removingId === null && returnFocusRemove.current !== null) {
      const target = removeOpenerRefs.current[returnFocusRemove.current]
      returnFocusRemove.current = null
      if (target) target.focus()
    }
  }, [removingId])

  function setCell(field, text) {
    setCellValues(prev => ({ ...prev, [field]: text }))
  }

  function discardChanges() {
    setCellValues(initialValues)
    setFieldErrors({})
    setFormAlert('')
  }

  function cancelException() {
    setExceptionMode(false)
    setReasonText('')
    discardChanges()
  }

  const recognisedTargetFields = useMemo(() => rows.flatMap(r => r.cells.map(c => c.field)).concat('reason'), [rows])

  async function handleTargetsSubmit(e) {
    e.preventDefault()
    if (inFlight.current || !dirty) return
    inFlight.current = true
    setSaving(true)
    setFieldErrors({})
    setFormAlert('')

    const cells = Object.keys(initialValues)
      .filter(field => (cellValues[field] ?? '') !== initialValues[field])
      .map(field => {
        const [, assignmentId, month] = field.split(':')
        return { assignmentId, month, value: cellValues[field] ?? '' }
      })

    const { status, json } = await callApi('/api/kpi/targets', 'POST', {
      scorecardId: scorecard.id,
      expectedStatus: scorecard.status,
      reason: exceptionMode ? reasonText : '',
      cells,
    })

    inFlight.current = false
    setSaving(false)

    if (status === 200) {
      setStatusMsg(exceptionMode ? 'Locked targets changed. Your reason is saved in the audit log.' : 'Targets saved.')
      startRefresh(() => router.refresh())
      return
    }

    const outcome = describeError(status, json, recognisedTargetFields)
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
      if (outcome.field === 'reason') {
        if (reasonRef.current) reasonRef.current.focus()
      } else {
        const ref = inputRefs.current[outcome.field]
        if (ref) ref.focus()
      }
      return
    }
    setFormAlert(outcome.alert)
    if (alertRef.current) alertRef.current.focus()
  }

  function openLifecycleAction(action) {
    setFormAlert('')
    setLifecycleNote('')
    setLifecycleDate('')
    setOpenLifecycle(action)
  }

  function closeLifecycle() {
    setOpenLifecycle(null)
  }

  async function handleLifecycleConfirm(action) {
    if (inFlight.current) return
    inFlight.current = true
    setLifecycleSaving(true)
    setFormAlert('')
    setFieldErrors({})

    const { status, json } = await callApi('/api/kpi/scorecards/status', 'PATCH', {
      id: scorecard.id,
      action,
      expectedStatus: scorecard.status,
      note: action === 'return' || action === 'record_board_approval' ? lifecycleNote : '',
      boardMeetingDate: action === 'record_board_approval' ? lifecycleDate : '',
    })

    inFlight.current = false
    setLifecycleSaving(false)

    if (status === 200) {
      const messages = {
        submit: 'Scorecard submitted.',
        return: 'Scorecard returned with your note.',
        approve: 'Scorecard approved and locked.',
        record_board_approval: 'Board approval recorded. The scorecard is locked.',
      }
      setStatusMsg(messages[action])
      setOpenLifecycle(null)
      startRefresh(() => router.refresh())
      return
    }

    const outcome = describeError(status, json, ['note', 'boardMeetingDate'])
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
      if (outcome.field === 'boardMeetingDate' && dateRef.current) dateRef.current.focus()
      if (outcome.field === 'note' && noteRef.current) noteRef.current.focus()
      return
    }
    setFormAlert(outcome.alert)
    if (alertRef.current) alertRef.current.focus()
  }

  function openRemove(assignmentId) {
    returnFocusRemove.current = null
    setRemovingId(assignmentId)
  }

  function closeRemove(assignmentId) {
    returnFocusRemove.current = assignmentId
    setRemovingId(null)
  }

  function handleRemoveKeyDown(e, assignmentId) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeRemove(assignmentId)
    }
  }

  async function handleRemoveConfirm(assignmentId) {
    if (inFlight.current) return
    inFlight.current = true
    setRemoveSaving(true)
    setFormAlert('')

    const { status, json } = await callApi('/api/kpi/assignments', 'DELETE', {
      assignmentId,
      expectedStatus: scorecard.status,
    })

    inFlight.current = false
    setRemoveSaving(false)

    if (status === 200) {
      setRemovingId(null)
      setStatusMsg('KPI removed.')
      startRefresh(() => router.refresh())
      return
    }

    const outcome = describeError(status, json, [])
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    setFormAlert(outcome.alert)
    if (alertRef.current) alertRef.current.focus()
  }

  async function handleAddKpi(e) {
    e.preventDefault()
    if (inFlight.current || addKpiId === '') return
    inFlight.current = true
    setAddSaving(true)
    setAddError('')
    setFormAlert('')

    const { status, json } = await callApi('/api/kpi/assignments', 'POST', {
      scorecardId: scorecard.id,
      kpiId: addKpiId,
      expectedStatus: scorecard.status,
    })

    inFlight.current = false
    setAddSaving(false)

    if (status === 201) {
      setAddKpiId('')
      setStatusMsg('KPI added.')
      startRefresh(() => router.refresh())
      return
    }

    const outcome = describeError(status, json, ['kpiId'])
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field === 'kpiId') {
      setAddError(outcome.message)
      return
    }
    setFormAlert(outcome.alert)
    if (alertRef.current) alertRef.current.focus()
  }

  const leadOptions = addOptions.filter(o => o.kpiType === 'lead')
  const lagOptions = addOptions.filter(o => o.kpiType === 'lag')

  const lifecycleOpen = openLifecycle !== null
  const submitButtonClass = lifecycleOpen ? styles.btnSecondary : styles.btnPrimary

  return (
    <div>
      <p className={styles.statusMsg} role="status" tabIndex={-1} ref={statusRef}>{statusMsg}</p>
      {formAlert && (
        <p className={styles.formAlert} role="alert" tabIndex={-1} ref={alertRef}>{formAlert}</p>
      )}

      <form onSubmit={handleTargetsSubmit} noValidate>
        <div className={styles.gridTableWrap} role="region" tabIndex={0} aria-label="KPIs and monthly targets table">
          <table className={styles.table + ' ' + styles.gridTable}>
            <caption className={styles.visuallyHidden}>KPIs and monthly targets</caption>
            <thead>
              <tr>
                <th scope="col">KPI</th>
                {monthLabels.map((label, i) => <th scope="col" key={months[i]}>{label}</th>)}
                {canEdit && <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.assignmentId}>
                  <td>
                    <Link href={`/kpis/library/${row.kpiId}?version=${row.version}`}>{row.name}</Link>
                    <p className={styles.kpiMeta}>{row.meta}</p>
                    {row.retired && <span className={styles.statusTag}>Retired in the library</span>}
                    {row.newer && <span className={styles.statusTag}>Newer version in the library</span>}
                  </td>
                  {row.cells.map((cell, i) => {
                    const error = fieldErrors[cell.field]
                    const describedById = error ? `${cell.field}-error` : undefined
                    return (
                      <td key={cell.field} className={editable ? undefined : styles.numCell}>
                        {editable ? (
                          <>
                            <label htmlFor={cell.field} className={styles.cellLabel}>
                              {row.name}, {monthLabels[i]}
                            </label>
                            <input
                              id={cell.field}
                              type="text"
                              inputMode="decimal"
                              autoComplete="off"
                              className={styles.cellInput}
                              value={cellValues[cell.field] ?? ''}
                              onChange={e => setCell(cell.field, e.target.value)}
                              ref={el => { inputRefs.current[cell.field] = el }}
                              aria-invalid={error ? 'true' : undefined}
                              aria-describedby={describedById}
                            />
                            {error && (
                              <span id={describedById} className={styles.fieldError}>{error}</span>
                            )}
                          </>
                        ) : (
                          cell.display
                        )}
                      </td>
                    )
                  })}
                  {canEdit && (
                    <td>
                      {removingId === row.assignmentId ? (
                        <div className={styles.confirmRow} onKeyDown={e => handleRemoveKeyDown(e, row.assignmentId)}>
                          <p className={styles.confirmText}>
                            Remove {row.name} from this scorecard? Its targets on this scorecard are deleted too.
                          </p>
                          <div className={styles.confirmActions}>
                            <button
                              type="button"
                              ref={keepItRef}
                              className={styles.btnSecondary}
                              onClick={() => closeRemove(row.assignmentId)}
                            >
                              Keep it
                            </button>
                            <button
                              type="button"
                              className={styles.btnDanger}
                              disabled={removeSaving}
                              aria-busy={removeSaving}
                              onClick={() => handleRemoveConfirm(row.assignmentId)}
                            >
                              {removeSaving ? 'Removing' : 'Remove KPI'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={styles.rowBtn}
                          disabled={dirty}
                          aria-describedby={dirty ? 'grid-dirty-helper' : undefined}
                          ref={el => { removeOpenerRefs.current[row.assignmentId] = el }}
                          onClick={() => openRemove(row.assignmentId)}
                        >
                          Remove<span className={styles.visuallyHidden}> {row.name}</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editable && (
          <p className={styles.helper}>
            Enter each month&apos;s target in the KPI&apos;s unit. For a percent KPI, enter 33 for
            33%. 0 is allowed.
          </p>
        )}

        {exceptionMode && (
          <div className={styles.field}>
            <label htmlFor="exception-reason">Reason for changing locked targets</label>
            <textarea
              id="exception-reason"
              required
              className={styles.textarea}
              value={reasonText}
              onChange={e => setReasonText(e.target.value)}
              ref={reasonRef}
              aria-invalid={fieldErrors.reason ? 'true' : undefined}
              aria-describedby={fieldErrors.reason ? 'exception-reason-error' : 'exception-reason-helper'}
            />
            {fieldErrors.reason ? (
              <span id="exception-reason-error" className={styles.fieldError}>{fieldErrors.reason}</span>
            ) : (
              <span id="exception-reason-helper" className={styles.helper}>
                Saved in the audit log with each changed target.
              </span>
            )}
          </div>
        )}

        <div className={styles.formActions}>
          {dirty && (
            <button type="button" className={styles.btnSecondary} onClick={discardChanges}>
              Discard changes
            </button>
          )}
          {exceptionMode && (
            <button type="button" className={styles.btnSecondary} onClick={cancelException}>
              Cancel
            </button>
          )}
          {editable && (
            <button
              type="submit"
              className={submitButtonClass}
              disabled={!dirty || saving}
              aria-busy={saving}
            >
              {saving ? 'Saving' : exceptionMode ? 'Save locked targets' : 'Save targets'}
            </button>
          )}
        </div>
      </form>

      {canEdit && (
        <form className={styles.form} onSubmit={handleAddKpi} noValidate>
          {!hasPublishedKpis ? (
            <p className={styles.emptyState}>
              No published KPIs yet. <Link href="/kpis/library">Propose one in the KPI library.</Link>
            </p>
          ) : addOptions.length === 0 ? (
            <p className={styles.emptyState}>
              Every published KPI that fits this scorecard is already on it.
            </p>
          ) : (
            <div className={styles.field}>
              <label htmlFor="add-kpi">Add a KPI</label>
              <select
                id="add-kpi"
                className={styles.select}
                value={addKpiId}
                onChange={e => setAddKpiId(e.target.value)}
                disabled={dirty}
                aria-describedby={dirty ? 'grid-dirty-helper' : addError ? 'add-kpi-error' : undefined}
                aria-invalid={addError ? 'true' : undefined}
              >
                <option value="">Choose a KPI</option>
                <optgroup label="Lead KPIs">
                  {leadOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </optgroup>
                <optgroup label="Lag KPIs">
                  {lagOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </optgroup>
              </select>
              {addError && <span id="add-kpi-error" className={styles.fieldError}>{addError}</span>}
              <button type="submit" className={styles.btnSecondary} disabled={dirty || addSaving} aria-busy={addSaving}>
                {addSaving ? 'Adding' : 'Add KPI'}
              </button>
            </div>
          )}
        </form>
      )}

      {dirty && (
        <span id="grid-dirty-helper" className={styles.visuallyHidden}>
          Save or discard your target changes first.
        </span>
      )}

      <div className={styles.lifecycleRow}>
        {actions.includes('submit') && openLifecycle !== 'submit' && (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={dirty}
            aria-describedby={dirty ? 'grid-dirty-helper' : undefined}
            onClick={() => openLifecycleAction('submit')}
          >
            Submit for approval
          </button>
        )}
        {actions.includes('return') && openLifecycle !== 'return' && (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={dirty}
            aria-describedby={dirty ? 'grid-dirty-helper' : undefined}
            onClick={() => openLifecycleAction('return')}
          >
            Return with a note
          </button>
        )}
        {actions.includes('approve') && openLifecycle !== 'approve' && (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={dirty}
            aria-describedby={dirty ? 'grid-dirty-helper' : undefined}
            onClick={() => openLifecycleAction('approve')}
          >
            Approve and lock
          </button>
        )}
        {actions.includes('record_board_approval') && openLifecycle !== 'record_board_approval' && (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={dirty}
            aria-describedby={dirty ? 'grid-dirty-helper' : undefined}
            onClick={() => openLifecycleAction('record_board_approval')}
          >
            Record board approval
          </button>
        )}
        {canException && !exceptionMode && (
          <button
            type="button"
            className={styles.btnSecondary}
            disabled={dirty}
            aria-describedby={dirty ? 'grid-dirty-helper' : undefined}
            onClick={() => setExceptionMode(true)}
          >
            Change locked targets
          </button>
        )}
      </div>

      {openLifecycle === 'submit' && (
        <div className={styles.confirmRow}>
          <p className={styles.confirmText}>
            Submit this scorecard for approval? Once it&apos;s submitted, only the approver can
            change it or return it.
          </p>
          <div className={styles.confirmActions}>
            <button type="button" ref={cancelRef} className={styles.btnSecondary} onClick={closeLifecycle}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={lifecycleSaving}
              aria-busy={lifecycleSaving}
              onClick={() => handleLifecycleConfirm('submit')}
            >
              {lifecycleSaving ? 'Saving' : 'Submit scorecard'}
            </button>
          </div>
        </div>
      )}

      {openLifecycle === 'return' && (
        <div className={styles.confirmRow}>
          <div className={styles.field}>
            <label htmlFor="return-note">What needs to change</label>
            <textarea
              id="return-note"
              required
              className={styles.textarea}
              value={lifecycleNote}
              onChange={e => setLifecycleNote(e.target.value)}
              ref={noteRef}
              aria-invalid={fieldErrors.note ? 'true' : undefined}
              aria-describedby={fieldErrors.note ? 'return-note-error' : 'return-note-helper'}
            />
            {fieldErrors.note ? (
              <span id="return-note-error" className={styles.fieldError}>{fieldErrors.note}</span>
            ) : (
              <span id="return-note-helper" className={styles.helper}>
                The owner sees this note when the scorecard is back in draft.
              </span>
            )}
          </div>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.btnSecondary} onClick={closeLifecycle}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={lifecycleSaving}
              aria-busy={lifecycleSaving}
              onClick={() => handleLifecycleConfirm('return')}
            >
              {lifecycleSaving ? 'Saving' : 'Return scorecard'}
            </button>
          </div>
        </div>
      )}

      {openLifecycle === 'approve' && (
        <div className={styles.confirmRow}>
          <p className={styles.confirmText}>
            Approve and lock this scorecard for {quarterLabel}? After this, only the admin can
            change it, and every change needs a reason.
          </p>
          <div className={styles.confirmActions}>
            <button type="button" ref={cancelRef} className={styles.btnSecondary} onClick={closeLifecycle}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={lifecycleSaving}
              aria-busy={lifecycleSaving}
              onClick={() => handleLifecycleConfirm('approve')}
            >
              {lifecycleSaving ? 'Saving' : 'Approve and lock'}
            </button>
          </div>
        </div>
      )}

      {openLifecycle === 'record_board_approval' && (
        <div className={styles.confirmRow}>
          <div className={styles.field}>
            <label htmlFor="board-date">Board meeting date</label>
            <input
              id="board-date"
              type="date"
              required
              max={new Date().toISOString().slice(0, 10)}
              className={styles.input}
              value={lifecycleDate}
              onChange={e => setLifecycleDate(e.target.value)}
              ref={dateRef}
              aria-invalid={fieldErrors.boardMeetingDate ? 'true' : undefined}
              aria-describedby={fieldErrors.boardMeetingDate ? 'board-date-error' : undefined}
            />
            {fieldErrors.boardMeetingDate && (
              <span id="board-date-error" className={styles.fieldError}>{fieldErrors.boardMeetingDate}</span>
            )}
          </div>
          <div className={styles.field}>
            <label htmlFor="board-reference">Board meeting reference</label>
            <input
              id="board-reference"
              type="text"
              required
              className={styles.input}
              value={lifecycleNote}
              onChange={e => setLifecycleNote(e.target.value)}
              ref={noteRef}
              aria-invalid={fieldErrors.note ? 'true' : undefined}
              aria-describedby={fieldErrors.note ? 'board-reference-error' : 'board-reference-helper'}
            />
            {fieldErrors.note ? (
              <span id="board-reference-error" className={styles.fieldError}>{fieldErrors.note}</span>
            ) : (
              <span id="board-reference-helper" className={styles.helper}>
                For example, Board minutes 14 Oct 2026.
              </span>
            )}
          </div>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.btnSecondary} onClick={closeLifecycle}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={lifecycleSaving}
              aria-busy={lifecycleSaving}
              onClick={() => handleLifecycleConfirm('record_board_approval')}
            >
              {lifecycleSaving ? 'Saving' : 'Record board approval'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
