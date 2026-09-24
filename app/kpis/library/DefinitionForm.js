'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { OPTIONS, DEFINITION_FIELDS } from '@/lib/kpi/library'
import { callApi, describeError } from '@/lib/kpi/clientApi'
import styles from '../kpis.module.css'

const CHOOSE_ONE_GROUPS = ['kpiType', 'unit', 'direction', 'aggregation', 'attributionMethod']

function emptyFields() {
  return {
    name: '',
    description: '',
    kpiType: '',
    unit: '',
    direction: '',
    aggregation: '',
    attributionMethod: '',
    phasing: 'working_days',
    source: OPTIONS.source[0].value,
    sourceMapping: '',
    attributionNote: '',
    exampleTarget: '',
  }
}

// DefinitionForm ('use client'): shared by /kpis/library/new (mode="propose")
// and /kpis/library/[id]/edit (mode="edit"). Every field is sent to the
// server as the raw string typed; the client never parses JSON or numbers
// (0+1 D11: validation lives once, on the server).
export default function DefinitionForm({ mode, id, version, initial }) {
  const router = useRouter()
  const isEdit = mode === 'edit'

  const [fields, setFields] = useState(() => (isEdit && initial ? { ...initial } : emptyFields()))
  const [fieldErrors, setFieldErrors] = useState({})
  const [alertMsg, setAlertMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const inFlight = useRef(false)
  const alertRef = useRef(null)
  const fieldRefs = useRef({})

  useEffect(() => {
    if (alertMsg && alertRef.current) alertRef.current.focus()
  }, [alertMsg])

  function setField(key, value) {
    setFields(prev => ({ ...prev, [key]: value }))
  }

  function registerRef(key) {
    return el => { fieldRefs.current[key] = el }
  }

  function fieldProps(key) {
    return {
      value: fields[key],
      onChange: e => setField(key, e.target.value),
      ref: registerRef(key),
      'aria-invalid': fieldErrors[key] ? 'true' : undefined,
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setFieldErrors({})
    setAlertMsg('')

    const body = isEdit
      ? { ...fields, id, version }
      : { ...fields }
    const { status, json } = await callApi('/api/kpi/definitions', isEdit ? 'PATCH' : 'POST', body)

    inFlight.current = false
    setSaving(false)

    if (status === 201 && json && json.definition) {
      router.push(`/kpis/library/${json.definition.id}?notice=proposed`)
      return
    }
    if (status === 200 && json && json.definition) {
      router.push(`/kpis/library/${id}?notice=saved`)
      return
    }

    const outcome = describeError(status, json, DEFINITION_FIELDS)
    if (outcome.redirect) {
      window.location.assign('/login')
      return
    }
    if (outcome.field) {
      setFieldErrors({ [outcome.field]: outcome.message })
      const el = fieldRefs.current[outcome.field]
      if (el) el.focus()
    } else {
      setAlertMsg(outcome.alert)
    }
  }

  const cancelHref = isEdit ? `/kpis/library/${id}` : '/kpis/library'

  return (
    <section className={`${styles.card} ${styles.formCard}`}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {alertMsg && (
          <p className={styles.formAlert} role="alert" tabIndex={-1} ref={alertRef}>
            {alertMsg}
          </p>
        )}

        <div className={styles.field}>
          <label htmlFor="df-name">Name</label>
          <input
            id="df-name"
            className={styles.input}
            required
            aria-describedby={fieldErrors.name ? 'df-name-error df-name-helper' : 'df-name-helper'}
            {...fieldProps('name')}
          />
          <p id="df-name-helper" className={styles.helper}>For example, Quotes sent.</p>
          {fieldErrors.name && <p id="df-name-error" className={styles.fieldError}>{fieldErrors.name}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="df-description">What it measures and why it matters</label>
          <textarea
            id="df-description"
            className={styles.textarea}
            required
            aria-describedby={fieldErrors.description ? 'df-description-error' : undefined}
            {...fieldProps('description')}
          />
          {fieldErrors.description && <p id="df-description-error" className={styles.fieldError}>{fieldErrors.description}</p>}
        </div>

        <SelectField
          id="df-kpiType"
          label="Type"
          group="kpiType"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />
        <SelectField
          id="df-unit"
          label="Unit"
          group="unit"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />
        <SelectField
          id="df-direction"
          label="Direction"
          group="direction"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />
        <SelectField
          id="df-aggregation"
          label="How values combine"
          group="aggregation"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />
        <SelectField
          id="df-attributionMethod"
          label="Who it counts towards"
          group="attributionMethod"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />
        <SelectField
          id="df-phasing"
          label="Target spread"
          group="phasing"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />
        <SelectField
          id="df-source"
          label="Data source"
          group="source"
          fields={fields}
          fieldErrors={fieldErrors}
          fieldProps={fieldProps}
        />

        <div className={styles.field}>
          <label htmlFor="df-sourceMapping">Source mapping (optional)</label>
          <textarea
            id="df-sourceMapping"
            className={styles.textareaMono}
            aria-describedby={fieldErrors.sourceMapping ? 'df-sourceMapping-error df-sourceMapping-helper' : 'df-sourceMapping-helper'}
            {...fieldProps('sourceMapping')}
          />
          <p id="df-sourceMapping-helper" className={styles.helper}>
            A JSON object describing where the data comes from. Leave it blank for manual KPIs, or
            if you&apos;re not sure. The admin completes it before a data connection uses it.
          </p>
          {fieldErrors.sourceMapping && <p id="df-sourceMapping-error" className={styles.fieldError}>{fieldErrors.sourceMapping}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="df-attributionNote">Note on who it counts towards (optional)</label>
          <textarea
            id="df-attributionNote"
            className={styles.textarea}
            aria-describedby={fieldErrors.attributionNote ? 'df-attributionNote-error df-attributionNote-helper' : 'df-attributionNote-helper'}
            {...fieldProps('attributionNote')}
          />
          <p id="df-attributionNote-helper" className={styles.helper}>
            Anything the admin should know about who this counts towards.
          </p>
          {fieldErrors.attributionNote && <p id="df-attributionNote-error" className={styles.fieldError}>{fieldErrors.attributionNote}</p>}
        </div>

        <div className={styles.field}>
          <label htmlFor="df-exampleTarget">Example monthly target (optional)</label>
          <input
            id="df-exampleTarget"
            className={styles.input}
            inputMode="decimal"
            aria-describedby={fieldErrors.exampleTarget ? 'df-exampleTarget-error df-exampleTarget-helper' : 'df-exampleTarget-helper'}
            {...fieldProps('exampleTarget')}
          />
          <p id="df-exampleTarget-helper" className={styles.helper}>
            Guidance for whoever sets targets. For a percent KPI, enter 33 for 33%.
          </p>
          {fieldErrors.exampleTarget && <p id="df-exampleTarget-error" className={styles.fieldError}>{fieldErrors.exampleTarget}</p>}
        </div>

        <div className={styles.formActions}>
          <Link href={cancelHref} className={styles.manageLink}>
            Cancel
          </Link>
          <button type="submit" className={styles.btnPrimary} disabled={saving} aria-busy={saving}>
            {saving ? 'Saving' : isEdit ? 'Save new version' : 'Propose KPI'}
          </button>
        </div>
      </form>
    </section>
  )
}

function SelectField({ id, label, group, fields, fieldErrors, fieldProps }) {
  const includeChooseOne = CHOOSE_ONE_GROUPS.includes(group) && fields[group] === ''
  const errorId = `${id}-error`
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className={styles.select}
        required
        aria-describedby={fieldErrors[group] ? errorId : undefined}
        {...fieldProps(group)}
      >
        {includeChooseOne && <option value="">Choose one</option>}
        {OPTIONS[group].map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
      {fieldErrors[group] && <p id={errorId} className={styles.fieldError}>{fieldErrors[group]}</p>}
    </div>
  )
}
