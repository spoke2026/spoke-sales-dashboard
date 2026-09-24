'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDayMonth, formatDayMonthYear } from '@/lib/kpi/format'
import styles from '../kpis.module.css'

const EMAIL_HELPER = 'Used to link this person to their login later.'
const REASON_PLACEHOLDER = 'Christmas shutdown'

async function callApi(url, method, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let json = null
    try {
      json = await res.json()
    } catch {
      json = null
    }
    return { status: res.status, json }
  } catch {
    return { status: 0, json: null }
  }
}

function describeError(status, json, recognizedFields) {
  if (status === 401) return { redirect: true }
  if (status === 403) return { alert: 'Only the admin can make changes here.' }
  if (status === 0 || status >= 500) return { alert: "We couldn't save that. Try again." }
  if (json && json.field && recognizedFields.includes(json.field)) {
    return { field: json.field, message: json.error }
  }
  return { alert: (json && json.error) || "We couldn't save that. Try again." }
}

export default function AdminPanels({ teams, people, closures, range }) {
  const router = useRouter()
  // Only one form open at a time across all three sections.
  const [openKey, setOpenKey] = useState(null)
  const openerRef = useRef(null)

  const teamsAddBtnRef = useRef(null)
  const peopleAddBtnRef = useRef(null)
  const closuresAddBtnRef = useRef(null)

  function openForm(key, opener) {
    setCloseConfirmDate(null)
    openerRef.current = opener
    setOpenKey(key)
  }

  function closeForm(returnFocus = true) {
    setOpenKey(null)
    if (returnFocus && openerRef.current) {
      openerRef.current.focus()
    }
  }

  function onSuccessClose(addBtnRef) {
    setOpenKey(null)
    if (addBtnRef.current) addBtnRef.current.focus()
  }

  const [closureConfirmDate, setCloseConfirmDate] = useState(null)

  return (
    <>
      <TeamsSection
        teams={teams}
        openKey={openKey}
        openForm={openForm}
        closeForm={closeForm}
        onSuccessClose={() => onSuccessClose(teamsAddBtnRef)}
        addBtnRef={teamsAddBtnRef}
        router={router}
      />
      <PeopleSection
        people={people}
        teams={teams}
        openKey={openKey}
        openForm={openForm}
        closeForm={closeForm}
        onSuccessClose={() => onSuccessClose(peopleAddBtnRef)}
        addBtnRef={peopleAddBtnRef}
        router={router}
      />
      <ClosuresSection
        closures={closures}
        range={range}
        openKey={openKey}
        openForm={openForm}
        closeForm={closeForm}
        onSuccessClose={() => onSuccessClose(closuresAddBtnRef)}
        addBtnRef={closuresAddBtnRef}
        router={router}
        confirmDate={closureConfirmDate}
        setConfirmDate={setCloseConfirmDate}
      />
    </>
  )
}

// ── TEAMS ────────────────────────────────────────────────────────────────
function TeamsSection({ teams, openKey, openForm, closeForm, onSuccessClose, addBtnRef, router }) {
  const editing = openKey && openKey.startsWith('teams:edit:') ? openKey.slice('teams:edit:'.length) : null
  const adding = openKey === 'teams:add'
  const isOpen = adding || editing !== null
  const team = editing ? teams.find(t => t.id === editing) : null

  const [name, setName] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [alertMsg, setAlertMsg] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  const inFlight = useRef(false)
  const firstFieldRef = useRef(null)

  useEffect(() => {
    if (isOpen && firstFieldRef.current) firstFieldRef.current.focus()
  }, [openKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the values in the same render that opens the form, so it never
  // shows the previous record's values for a frame.
  function loadForm(t) {
    setName(t === null ? '' : t.name)
    setActive(t === null ? true : t.active)
    setFieldErrors({})
    setAlertMsg('')
    setStatusMsg('')
  }

  function handleAddClick(e) {
    loadForm(null)
    openForm('teams:add', e.currentTarget)
  }

  function handleEditClick(e, t) {
    loadForm(t)
    openForm(`teams:edit:${t.id}`, e.currentTarget)
  }

  function handleCancel() {
    closeForm()
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeForm()
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFieldErrors({})
    setAlertMsg('')

    const body = editing
      ? { id: editing, name, active }
      : { name }
    const { status, json } = await callApi('/api/kpi/teams', editing ? 'PATCH' : 'POST', body)

    inFlight.current = false
    if (status === 200 || status === 201) {
      setSaving(false)
      setStatusMsg(editing ? 'Team saved.' : 'Team added.')
      onSuccessClose()
      router.refresh()
      return
    }

    const outcome = describeError(status, json, ['name'])
    setSaving(false)
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
    } else {
      setAlertMsg(outcome.alert)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.sectionTitle}>Teams</h2>
        <button type="button" ref={addBtnRef} className={styles.btnSecondary} onClick={handleAddClick}>
          Add team
        </button>
      </div>

      <p className={styles.statusMsg} role="status">{statusMsg}</p>

      {isOpen && (
        <form className={styles.form} onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate>
          {alertMsg && <p className={styles.formAlert} role="alert">{alertMsg}</p>}
          <div className={styles.field}>
            <label htmlFor="team-name">Team name</label>
            <input
              id="team-name"
              name="name"
              ref={firstFieldRef}
              className={styles.input}
              value={name}
              onChange={e => setName(e.target.value)}
              required
              aria-invalid={fieldErrors.name ? 'true' : undefined}
              aria-describedby={fieldErrors.name ? 'team-name-error' : undefined}
            />
            {fieldErrors.name && <p id="team-name-error" className={styles.fieldError}>{fieldErrors.name}</p>}
          </div>
          {editing && (
            <div className={styles.checkboxRow}>
              <input
                id="team-active"
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
              />
              <label htmlFor="team-active">Active</label>
            </div>
          )}
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={handleCancel}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving} aria-busy={saving}>
              {saving ? 'Saving' : editing ? 'Save team' : 'Add team'}
            </button>
          </div>
        </form>
      )}

      {teams.length === 0 ? (
        <p className={styles.emptyState}>No teams yet. Add a team, for example Sales.</p>
      ) : (
        <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Teams table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>Teams</caption>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col">Status</th>
                <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {teams.map(t => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.active ? 'Active' : 'Inactive'}</td>
                  <td>
                    <button type="button" className={styles.rowBtn} onClick={e => handleEditClick(e, t)}>
                      Edit <span className={styles.visuallyHidden}>{t.name}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── PEOPLE ───────────────────────────────────────────────────────────────
function PeopleSection({ people, teams, openKey, openForm, closeForm, onSuccessClose, addBtnRef, router }) {
  const editing = openKey && openKey.startsWith('people:edit:') ? openKey.slice('people:edit:'.length) : null
  const adding = openKey === 'people:add'
  const isOpen = adding || editing !== null
  const person = editing ? people.find(p => p.id === editing) : null

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [primaryTeamId, setPrimaryTeamId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [isContractor, setIsContractor] = useState(false)
  const [scorecardType, setScorecardType] = useState('individual')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [alertMsg, setAlertMsg] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  const inFlight = useRef(false)
  const firstFieldRef = useRef(null)

  useEffect(() => {
    if (isOpen && firstFieldRef.current) firstFieldRef.current.focus()
  }, [openKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load the values in the same render that opens the form, so it never
  // shows the previous record's values for a frame.
  function loadForm(p) {
    setFullName(p === null ? '' : p.full_name)
    setEmail(p === null || p.email === null ? '' : p.email)
    setPrimaryTeamId(p === null || p.primary_team_id === null ? '' : p.primary_team_id)
    setManagerId(p === null || p.manager_id === null ? '' : p.manager_id)
    setIsContractor(p === null ? false : p.is_contractor)
    setScorecardType(p === null ? 'individual' : p.scorecard_type)
    setActive(p === null ? true : p.active)
    setFieldErrors({})
    setAlertMsg('')
    setStatusMsg('')
  }

  const teamOptions = useMemo(() => {
    const active = teams.filter(t => t.active)
    if (person && person.primary_team_id) {
      const current = teams.find(t => t.id === person.primary_team_id)
      if (current && !current.active && !active.find(t => t.id === current.id)) {
        return [...active, current]
      }
    }
    return active
  }, [teams, person])

  const managerOptions = useMemo(() => {
    const selfId = editing
    const activeOthers = people.filter(p => p.active && p.id !== selfId)
    if (person && person.manager_id) {
      const current = people.find(p => p.id === person.manager_id)
      if (current && !current.active && !activeOthers.find(p => p.id === current.id)) {
        return [...activeOthers, current]
      }
    }
    return activeOthers
  }, [people, person, editing])

  function handleAddClick(e) {
    loadForm(null)
    openForm('people:add', e.currentTarget)
  }

  function handleEditClick(e, p) {
    loadForm(p)
    openForm(`people:edit:${p.id}`, e.currentTarget)
  }

  function handleCancel() {
    closeForm()
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeForm()
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFieldErrors({})
    setAlertMsg('')

    const base = {
      fullName,
      email,
      primaryTeamId: primaryTeamId === '' ? null : primaryTeamId,
      managerId: managerId === '' ? null : managerId,
      isContractor,
      scorecardType,
    }
    const body = editing ? { id: editing, ...base, active } : base
    const { status, json } = await callApi('/api/kpi/people', editing ? 'PATCH' : 'POST', body)

    inFlight.current = false
    if (status === 200 || status === 201) {
      setSaving(false)
      setStatusMsg(editing ? 'Person saved.' : 'Person added.')
      onSuccessClose()
      router.refresh()
      return
    }

    const outcome = describeError(status, json, ['fullName', 'email', 'managerId', 'primaryTeamId', 'scorecardType'])
    setSaving(false)
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
    } else {
      setAlertMsg(outcome.alert)
    }
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.sectionTitle}>People</h2>
        <button type="button" ref={addBtnRef} className={styles.btnSecondary} onClick={handleAddClick}>
          Add person
        </button>
      </div>

      <p className={styles.statusMsg} role="status">{statusMsg}</p>

      {isOpen && (
        <form className={styles.form} onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate>
          {alertMsg && <p className={styles.formAlert} role="alert">{alertMsg}</p>}
          <div className={styles.field}>
            <label htmlFor="person-fullName">Full name</label>
            <input
              id="person-fullName"
              ref={firstFieldRef}
              className={styles.input}
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              aria-invalid={fieldErrors.fullName ? 'true' : undefined}
              aria-describedby={fieldErrors.fullName ? 'person-fullName-error' : undefined}
            />
            {fieldErrors.fullName && <p id="person-fullName-error" className={styles.fieldError}>{fieldErrors.fullName}</p>}
          </div>

          <div className={styles.field}>
            <label htmlFor="person-email">Email</label>
            <input
              id="person-email"
              type="email"
              className={styles.input}
              value={email}
              onChange={e => setEmail(e.target.value)}
              aria-invalid={fieldErrors.email ? 'true' : undefined}
              aria-describedby={fieldErrors.email ? 'person-email-error person-email-helper' : 'person-email-helper'}
            />
            <p id="person-email-helper" className={styles.helper}>{EMAIL_HELPER}</p>
            {fieldErrors.email && <p id="person-email-error" className={styles.fieldError}>{fieldErrors.email}</p>}
          </div>

          <div className={styles.field}>
            <label htmlFor="person-team">Team</label>
            <select
              id="person-team"
              className={styles.select}
              value={primaryTeamId}
              onChange={e => setPrimaryTeamId(e.target.value)}
            >
              <option value="">No team</option>
              {teamOptions.map(t => (
                <option key={t.id} value={t.id}>{t.active ? t.name : `${t.name} (inactive)`}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="person-manager">Line manager</label>
            <select
              id="person-manager"
              className={styles.select}
              value={managerId}
              onChange={e => setManagerId(e.target.value)}
              aria-invalid={fieldErrors.managerId ? 'true' : undefined}
              aria-describedby={fieldErrors.managerId ? 'person-manager-error' : undefined}
            >
              <option value="">No line manager</option>
              {managerOptions.map(p => (
                <option key={p.id} value={p.id}>{p.active ? p.full_name : `${p.full_name} (inactive)`}</option>
              ))}
            </select>
            {fieldErrors.managerId && <p id="person-manager-error" className={styles.fieldError}>{fieldErrors.managerId}</p>}
          </div>

          <div className={styles.checkboxRow}>
            <input
              id="person-contractor"
              type="checkbox"
              checked={isContractor}
              onChange={e => setIsContractor(e.target.checked)}
            />
            <label htmlFor="person-contractor">External contractor</label>
          </div>

          <div className={styles.field}>
            <label htmlFor="person-scorecard">Scorecard</label>
            <select
              id="person-scorecard"
              className={styles.select}
              value={scorecardType}
              onChange={e => setScorecardType(e.target.value)}
            >
              <option value="individual">Individual</option>
              <option value="company_only">Company only</option>
            </select>
          </div>

          {editing && (
            <div className={styles.checkboxRow}>
              <input
                id="person-active"
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
              />
              <label htmlFor="person-active">Active</label>
            </div>
          )}

          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={handleCancel}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving} aria-busy={saving}>
              {saving ? 'Saving' : editing ? 'Save person' : 'Add person'}
            </button>
          </div>
        </form>
      )}

      {people.length === 0 ? (
        <p className={styles.emptyState}>No people yet. Add the first person to start building scorecards.</p>
      ) : (
        <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="People table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>People</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Team</th>
                <th scope="col">Line manager</th>
                <th scope="col">Type</th>
                <th scope="col">Scorecard</th>
                <th scope="col">Status</th>
                <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {people.map(p => {
                const teamName = teams.find(t => t.id === p.primary_team_id)?.name || 'Not set'
                const managerName = people.find(m => m.id === p.manager_id)?.full_name || 'Not set'
                return (
                  <tr key={p.id}>
                    <td>{p.full_name}</td>
                    <td>{p.email || 'Not set'}</td>
                    <td>{teamName}</td>
                    <td>{managerName}</td>
                    <td>{p.is_contractor ? 'Contractor' : 'Internal'}</td>
                    <td>{p.scorecard_type === 'company_only' ? 'Company only' : 'Individual'}</td>
                    <td>{p.active ? 'Active' : 'Inactive'}</td>
                    <td>
                      <button type="button" className={styles.rowBtn} onClick={e => handleEditClick(e, p)}>
                        Edit <span className={styles.visuallyHidden}>{p.full_name}</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── COMPANY CLOSURES ───────────────────────────────────────────────────────
function ClosuresSection({ closures, range, openKey, openForm, closeForm, onSuccessClose, addBtnRef, router, confirmDate, setConfirmDate }) {
  const isOpen = openKey === 'closures:add'

  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [alertMsg, setAlertMsg] = useState('')
  const [statusMsg, setStatusMsg] = useState('')

  const inFlight = useRef(false)
  const firstFieldRef = useRef(null)
  const keepItRef = useRef(null)
  const removeBtnRefs = useRef({})
  const [focusRemoveFor, setFocusRemoveFor] = useState(null)

  // The Remove button is replaced by the confirm row while it is open, so
  // focus moves to "Keep it" on open and back to that row's Remove on close.
  useEffect(() => {
    if (confirmDate !== null && keepItRef.current) keepItRef.current.focus()
  }, [confirmDate])

  useEffect(() => {
    if (focusRemoveFor === null) return
    const btn = removeBtnRefs.current[focusRemoveFor]
    if (btn) btn.focus()
    setFocusRemoveFor(null)
  }, [focusRemoveFor])

  useEffect(() => {
    if (isOpen && firstFieldRef.current) firstFieldRef.current.focus()
  }, [openKey]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleAddClick(e) {
    setDate('')
    setReason('')
    setFieldErrors({})
    setAlertMsg('')
    setStatusMsg('')
    openForm('closures:add', e.currentTarget)
  }

  function handleCancel() {
    closeForm()
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeForm()
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFieldErrors({})
    setAlertMsg('')

    const { status, json } = await callApi('/api/kpi/closures', 'POST', { date, reason })

    inFlight.current = false
    if (status === 200 || status === 201) {
      setSaving(false)
      setStatusMsg('Closure added.')
      onSuccessClose()
      router.refresh()
      return
    }

    const outcome = describeError(status, json, ['date', 'reason'])
    setSaving(false)
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
    } else {
      setAlertMsg(outcome.alert)
    }
  }

  function handleRemoveClick(closureDate) {
    setStatusMsg('')
    setAlertMsg('')
    if (isOpen) closeForm(false)
    setConfirmDate(closureDate)
  }

  function handleKeepIt(closureDate) {
    setConfirmDate(null)
    setFocusRemoveFor(closureDate)
  }

  async function handleRemoveConfirm(closureDate) {
    if (inFlight.current) return
    inFlight.current = true
    setRemoving(true)
    setAlertMsg('')
    const { status, json } = await callApi('/api/kpi/closures', 'DELETE', { date: closureDate })
    inFlight.current = false
    setRemoving(false)

    if (status === 200) {
      setConfirmDate(null)
      setStatusMsg('Closure removed.')
      if (addBtnRef.current) addBtnRef.current.focus()
      router.refresh()
      return
    }

    if (status === 401) {
      window.location.assign('/login')
      return
    }
    if (status === 403) {
      setAlertMsg('Only the admin can make changes here.')
      return
    }
    setAlertMsg((json && json.error) || "We couldn't save that. Try again.")
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <h2 className={styles.sectionTitle}>Company closures</h2>
        <button type="button" ref={addBtnRef} className={styles.btnSecondary} onClick={handleAddClick}>
          Add closure
        </button>
      </div>

      <p className={styles.statusMsg} role="status">{statusMsg}</p>
      {alertMsg && !isOpen && <p className={styles.formAlert} role="alert">{alertMsg}</p>}

      {isOpen && (
        <form className={styles.form} onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate>
          {alertMsg && <p className={styles.formAlert} role="alert">{alertMsg}</p>}
          <div className={styles.field}>
            <label htmlFor="closure-date">Date</label>
            <input
              id="closure-date"
              type="date"
              ref={firstFieldRef}
              className={styles.input}
              value={date}
              min={range?.min || undefined}
              max={range?.max || undefined}
              onChange={e => setDate(e.target.value)}
              required
              aria-invalid={fieldErrors.date ? 'true' : undefined}
              aria-describedby={fieldErrors.date ? 'closure-date-error' : undefined}
            />
            {fieldErrors.date && <p id="closure-date-error" className={styles.fieldError}>{fieldErrors.date}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor="closure-reason">Reason</label>
            <input
              id="closure-reason"
              className={styles.input}
              placeholder={REASON_PLACEHOLDER}
              value={reason}
              onChange={e => setReason(e.target.value)}
              required
              aria-invalid={fieldErrors.reason ? 'true' : undefined}
              aria-describedby={fieldErrors.reason ? 'closure-reason-error' : undefined}
            />
            {fieldErrors.reason && <p id="closure-reason-error" className={styles.fieldError}>{fieldErrors.reason}</p>}
          </div>
          <div className={styles.formActions}>
            <button type="button" className={styles.btnSecondary} onClick={handleCancel}>Cancel</button>
            <button type="submit" className={styles.btnPrimary} disabled={saving} aria-busy={saving}>
              {saving ? 'Saving' : 'Add closure'}
            </button>
          </div>
        </form>
      )}

      {closures.length === 0 ? (
        <p className={styles.emptyState}>
          No company closures. Add days the whole company is closed, such as the Christmas shutdown.
        </p>
      ) : (
        <div className={styles.tableWrap} role="region" tabIndex={0} aria-label="Company closures table">
          <table className={styles.table}>
            <caption className={styles.visuallyHidden}>Company closures</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Reason</th>
                <th scope="col"><span className={styles.visuallyHidden}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {closures.map(c => (
                <tr key={c.date}>
                  <td className={styles.mono}>{formatDayMonthYear(c.date)}</td>
                  <td>{c.reason}</td>
                  <td>
                    {confirmDate === c.date ? (
                      <div className={styles.confirmRow}>
                        <p className={styles.confirmText}>
                          Remove the closure on {formatDayMonthYear(c.date)}? It becomes a working day again.
                        </p>
                        <div className={styles.confirmActions}>
                          <button type="button" ref={keepItRef} className={styles.btnSecondary} onClick={() => handleKeepIt(c.date)}>
                            Keep it
                          </button>
                          <button
                            type="button"
                            className={styles.btnDanger}
                            disabled={removing}
                            aria-busy={removing}
                            onClick={() => handleRemoveConfirm(c.date)}
                          >
                            {removing ? 'Saving' : 'Remove closure'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        ref={el => { removeBtnRefs.current[c.date] = el }}
                        className={styles.rowBtn}
                        onClick={() => handleRemoveClick(c.date)}
                      >
                        Remove <span className={styles.visuallyHidden}>{formatDayMonth(c.date)}, {c.reason}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
