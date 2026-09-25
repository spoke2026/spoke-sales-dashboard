'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { callApi, describeError } from '@/lib/kpi/clientApi'
import { formatDayMonthYear } from '@/lib/kpi/format'
import styles from '../kpis.module.css'

// EntryGrid ('use client'): the week grid of manual KPI entries. Follows
// ScorecardWorkspace's patterns (in-flight ref, status focus after refresh
// settles via useTransition, field focus on error). The page keys this
// component on the entries' values, so its state resets after a
// router.refresh() rather than carrying stale edits forward.
export default function EntryGrid({ personId, weekStart, days, rows, prevHref, thisHref, isThisWeek, nextHref }) {
  const router = useRouter()
  const [refreshing, startRefresh] = useTransition()

  const initialValues = useMemo(() => {
    const map = {}
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.state !== 'editable') continue
        map[cell.field] = { value: cell.initialValue, outOf: cell.initialOutOf }
      }
    }
    return map
  }, [rows])

  const rowsSignature = useMemo(
    () => rows.map(r => `${r.kpiId}:${r.cells.map(c => `${c.field}=${c.state}=${c.initialValue}=${c.initialOutOf}`).join(',')}`).join('|'),
    [rows]
  )

  const [values, setValues] = useState(initialValues)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formAlert, setFormAlert] = useState('')
  const [statusMsg, setStatusMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const inFlight = useRef(false)
  const statusRef = useRef(null)
  const alertRef = useRef(null)
  const inputRefs = useRef({})

  useEffect(() => {
    if (statusMsg !== '' && !refreshing && statusRef.current) statusRef.current.focus()
  }, [statusMsg, refreshing])

  useEffect(() => {
    setValues(initialValues)
    setFieldErrors({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsSignature])

  const dirty = Object.keys(initialValues).some(field => {
    const cur = values[field] ?? { value: '', outOf: '' }
    const init = initialValues[field]
    return cur.value !== init.value || cur.outOf !== init.outOf
  })

  const recognisedFields = useMemo(() => rows.flatMap(r => r.cells.map(c => c.field)), [rows])

  function setValue(field, text) {
    setValues(prev => ({ ...prev, [field]: { ...(prev[field] ?? { value: '', outOf: '' }), value: text } }))
  }

  function setOutOf(field, text) {
    setValues(prev => ({ ...prev, [field]: { ...(prev[field] ?? { value: '', outOf: '' }), outOf: text } }))
  }

  function discardChanges() {
    setValues(initialValues)
    setFieldErrors({})
    setFormAlert('')
  }

  function navGuard(e) {
    e.preventDefault()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current || !dirty) return
    inFlight.current = true
    setSaving(true)
    setFieldErrors({})
    setFormAlert('')

    const cells = []
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cell.state !== 'editable') continue
        const cur = values[cell.field] ?? { value: '', outOf: '' }
        const init = initialValues[cell.field]
        if (cur.value !== init.value || cur.outOf !== init.outOf) {
          cells.push({ kpiId: row.kpiId, date: cell.date, value: cur.value, outOf: cur.outOf })
        }
      }
    }

    const { status, json } = await callApi('/api/kpi/entries', 'POST', { personId, weekStart, cells })

    inFlight.current = false
    setSaving(false)

    if (status === 200) {
      setStatusMsg('Entries saved.')
      startRefresh(() => router.refresh())
      return
    }

    const outcome = describeError(status, json, recognisedFields)
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
      const ref = inputRefs.current[outcome.field]
      if (ref) ref.focus()
      return
    }
    setFormAlert(outcome.alert)
    if (alertRef.current) alertRef.current.focus()
  }

  return (
    <div>
      <p className={styles.statusMsg} role="status" tabIndex={-1} ref={statusRef}>{statusMsg}</p>
      {formAlert && (
        <p className={styles.formAlert} role="alert" tabIndex={-1} ref={alertRef}>{formAlert}</p>
      )}

      <nav className={styles.weekNav} aria-label="Week navigation">
        <Link
          href={prevHref}
          className={styles.btnSecondary}
          aria-disabled={dirty ? 'true' : undefined}
          tabIndex={dirty ? -1 : undefined}
          onClick={dirty ? navGuard : undefined}
          aria-describedby={dirty ? 'entry-dirty-helper' : undefined}
        >
          Previous week
        </Link>
        {!isThisWeek && (
          <Link
            href={thisHref}
            className={styles.btnSecondary}
            aria-disabled={dirty ? 'true' : undefined}
            tabIndex={dirty ? -1 : undefined}
            onClick={dirty ? navGuard : undefined}
            aria-describedby={dirty ? 'entry-dirty-helper' : undefined}
          >
            This week
          </Link>
        )}
        {nextHref && (
          <Link
            href={nextHref}
            className={styles.btnSecondary}
            aria-disabled={dirty ? 'true' : undefined}
            tabIndex={dirty ? -1 : undefined}
            onClick={dirty ? navGuard : undefined}
            aria-describedby={dirty ? 'entry-dirty-helper' : undefined}
          >
            Next week
          </Link>
        )}
      </nav>
      {dirty && (
        <span id="entry-dirty-helper" className={styles.visuallyHidden}>
          Save or discard your changes first.
        </span>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <div className={styles.gridTableWrap} role="region" tabIndex={0} aria-label="Actuals for the week table">
          <table className={styles.table + ' ' + styles.gridTable}>
            <caption className={styles.visuallyHidden}>
              Actuals for the week of {formatDayMonthYear(weekStart)}
            </caption>
            <thead>
              <tr>
                <th scope="col">KPI</th>
                {days.map(day => (
                  <th scope="col" key={day.date}>
                    {day.label}
                    {day.isToday && <><br />Today</>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.kpiId}>
                  <td>
                    <span>{row.name}</span>
                    <p className={styles.kpiMeta}>{row.helper}</p>
                  </td>
                  {row.cells.map((cell, i) => {
                    const day = days[i]
                    const error = fieldErrors[cell.field]
                    const errorId = error ? `${cell.field}-error` : undefined
                    const missingId = cell.missing ? `${cell.field}-missing` : undefined
                    const describedBy = [missingId, errorId].filter(Boolean).join(' ') || undefined
                    const cur = values[cell.field] ?? { value: '', outOf: '' }

                    return (
                      <td key={cell.field} className={cell.state === 'closed' ? styles.numCell : undefined}>
                        {cell.state === 'not_scored' && 'Not on scorecard'}
                        {cell.state === 'future' && 'Not yet'}
                        {cell.state === 'closed' && cell.display}
                        {cell.state === 'editable' && (
                          <>
                            {row.aggregation === 'ratio' ? (
                              <div className={styles.ratioPair}>
                                <div>
                                  <label htmlFor={cell.field} className={styles.cellLabel}>
                                    <span className={styles.visuallyHidden}>{row.name}, </span>{day.label}
                                  </label>
                                  <input
                                    id={cell.field}
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className={styles.cellInput + ' ' + styles.entryInput}
                                    value={cur.value}
                                    onChange={e => setValue(cell.field, e.target.value)}
                                    ref={el => { inputRefs.current[cell.field] = el }}
                                    aria-invalid={error ? 'true' : undefined}
                                    aria-describedby={describedBy}
                                  />
                                </div>
                                out of
                                <div>
                                  <label htmlFor={`${cell.field}-outof`} className={styles.cellLabel}>
                                    <span className={styles.visuallyHidden}>{row.name}, </span>{day.label}, out of
                                  </label>
                                  <input
                                    id={`${cell.field}-outof`}
                                    type="text"
                                    inputMode="decimal"
                                    autoComplete="off"
                                    className={styles.cellInput + ' ' + styles.entryInput}
                                    value={cur.outOf}
                                    onChange={e => setOutOf(cell.field, e.target.value)}
                                    aria-invalid={error ? 'true' : undefined}
                                    aria-describedby={describedBy}
                                  />
                                </div>
                              </div>
                            ) : (
                              <>
                                <label htmlFor={cell.field} className={styles.cellLabel}>
                                  <span className={styles.visuallyHidden}>{row.name}, </span>{day.label}
                                </label>
                                <input
                                  id={cell.field}
                                  type="text"
                                  inputMode="decimal"
                                  autoComplete="off"
                                  className={styles.cellInput + ' ' + styles.entryInput}
                                  value={cur.value}
                                  onChange={e => setValue(cell.field, e.target.value)}
                                  ref={el => { inputRefs.current[cell.field] = el }}
                                  aria-invalid={error ? 'true' : undefined}
                                  aria-describedby={describedBy}
                                />
                              </>
                            )}
                            {cell.missing && (
                              <p id={missingId} className={styles.missingFlag}>
                                <span aria-hidden="true">✗</span> Missing
                              </p>
                            )}
                            {error && (
                              <span id={errorId} className={styles.fieldError}>{error}</span>
                            )}
                          </>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles.formActions}>
          {dirty && (
            <button type="button" className={styles.btnSecondary} onClick={discardChanges}>
              Discard changes
            </button>
          )}
          <button type="submit" className={styles.btnPrimary} disabled={!dirty || saving} aria-busy={saving}>
            {saving ? 'Saving' : 'Save entries'}
          </button>
        </div>
      </form>
    </div>
  )
}
