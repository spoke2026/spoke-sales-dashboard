// Pure helpers for the KPI library (Phase 2a).
//
// No imports. Never mutates its inputs. Validators never throw: they return a
// result object the route maps to a response. Request bodies are frozen, so a
// missing or extra key fails validation (rule 6). Explicit type and null checks
// throughout, never truthiness on values where 0 or '' mean something (rule 3).
//
// This is the one implementation of the option lists, labels, the status
// transition rule, current-version selection, change detection, example-target
// unit conversion, and DB error mapping (rule 7). The API and the pages both
// read it.

// Same regex text as lib/kpi/admin.js. Kept private there, so repeated here.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TARGET_RE = /^\d+(\.\d+)?$/

const GENERIC_ERROR = { ok: false, status: 400, error: "We couldn't save that. Try again." }
const STALE_ERROR = 'This KPI changed since you opened it. Refresh the page to see the latest version.'

function freezeOptions(list) {
  return Object.freeze(list.map(([value, label]) => Object.freeze({ value, label })))
}

export const OPTIONS = Object.freeze({
  kpiType: freezeOptions([
    ['lead', 'Lead (drives future results)'],
    ['lag', 'Lag (measures results)'],
  ]),
  unit: freezeOptions([
    ['count', 'Count'],
    ['currency', 'Dollars ($)'],
    ['percent', 'Percent (%)'],
    ['hours', 'Hours'],
    ['days', 'Days'],
    ['multiple', 'Multiple (×)'],
  ]),
  direction: freezeOptions([
    ['higher', 'Higher is better'],
    ['lower', 'Lower is better'],
  ]),
  aggregation: freezeOptions([
    ['sum', 'Sum: adds up over the period'],
    ['average', 'Average: the mean of the values'],
    ['ratio', 'Ratio: one total divided by another'],
    ['latest', 'Latest: the most recent value'],
  ]),
  phasing: freezeOptions([
    ['working_days', 'Across working days'],
    ['calendar_days', 'Across every calendar day'],
  ]),
  source: freezeOptions([
    ['hubspot', 'HubSpot'],
    ['xero', 'Xero'],
    ['forecast', 'Forecast (forecast.spoke.nz)'],
    ['manual', 'Manual entry'],
  ]),
  attributionMethod: freezeOptions([
    ['record_owner', "The record's owner in the source system"],
    ['entered_for_person', 'The person the entry is for'],
    ['company', 'The company as a whole'],
  ]),
  status: freezeOptions([
    ['proposed', 'Proposed'],
    ['published', 'Published'],
    ['retired', 'Retired'],
  ]),
})

function isOption(group, value) {
  return OPTIONS[group].some(option => option.value === value)
}

// Never blank (rule 8): a value outside the list reads 'Unknown'.
export function labelFor(group, value) {
  const list = Object.prototype.hasOwnProperty.call(OPTIONS, group) ? OPTIONS[group] : []
  const match = list.find(option => option.value === value)
  return match === undefined ? 'Unknown' : match.label
}

// The one transition rule. Nothing leaves retired.
const TRANSITIONS = Object.freeze({
  proposed: Object.freeze(['published', 'retired']),
  published: Object.freeze(['retired']),
})

export function canTransition(from, to) {
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, from)) return false
  return TRANSITIONS[from].includes(to)
}

const STATUS_RANK = Object.freeze({ published: 0, proposed: 1, retired: 2 })

function statusRank(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_RANK, status) ? STATUS_RANK[status] : 3
}

function compareNames(a, b) {
  const x = String(a).toLowerCase()
  const y = String(b).toLowerCase()
  if (x < y) return -1
  if (x > y) return 1
  return 0
}

// For each id, the row with the greatest version, whatever order the rows
// arrive in. Sorted by status (published, proposed, retired), then name.
export function latestVersions(rows) {
  const byId = new Map()
  for (const row of rows) {
    const seen = byId.get(row.id)
    if (seen === undefined || row.version > seen.version) byId.set(row.id, row)
  }
  return [...byId.values()].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status)
    if (rank !== 0) return rank
    return compareNames(a.name, b.name)
  })
}

// Example targets are stored in the same units as targets: percent as a
// fraction (33% is 0.33). Only 'percent' converts.
export function toStoredNumber(unit, n) {
  return unit === 'percent' ? n / 100 : n
}

// toFixed(6) removes float drift: 0.29 * 100 is 28.999999999999996.
export function toDisplayNumber(unit, n) {
  return unit === 'percent' ? Number((n * 100).toFixed(6)) : n
}

// PostgREST returns numeric as a JSON number, but convert at the boundary in
// case it ever arrives as a string (rule 11). null stays null; anything that
// isn't a readable non-negative number becomes NaN, so it shows as
// unreadable rather than as "Not set" (rule 8).
export function readStoredNumber(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  if (typeof raw === 'string' && TARGET_RE.test(raw)) return Number(raw)
  return NaN
}

// Display only. Uses Intl, so call it from server components only.
export function formatExampleTarget(unit, stored) {
  if (stored === null) return 'Not set'
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return 'Unreadable'
  const d = toDisplayNumber(unit, stored)
  const text = new Intl.NumberFormat('en-NZ', { maximumFractionDigits: 2 }).format(d)
  if (unit === 'currency') return `$${text}`
  if (unit === 'percent') return `${text}%`
  if (unit === 'hours') return d === 1 ? '1 hour' : `${text} hours`
  if (unit === 'days') return d === 1 ? '1 day' : `${text} days`
  if (unit === 'multiple') return `${text}×`
  return text
}

// "Proposed by" and "Saved by": the kpi_person whose email matches the saved
// email (case-insensitive), else the email itself, else 'Not recorded'.
// Display only; the real login link is Phase 2b's decision.
export function savedByLabel(email, people) {
  if (typeof email !== 'string' || email.trim() === '') return 'Not recorded'
  const wanted = email.trim().toLowerCase()
  const person = people.find(p => typeof p.email === 'string' && p.email.trim().toLowerCase() === wanted)
  return person === undefined ? email : person.full_name
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Frozen body: every listed key present, and nothing else (rule 6).
function hasExactKeys(body, keys) {
  const present = Object.keys(body)
  return present.length === keys.length && keys.every(k => present.includes(k))
}

function fieldError(field, error) {
  return { ok: false, status: 400, field, error }
}

const CREATE_KEYS = Object.freeze([
  'name',
  'description',
  'kpiType',
  'unit',
  'direction',
  'aggregation',
  'phasing',
  'source',
  'sourceMapping',
  'attributionMethod',
  'attributionNote',
  'exampleTarget',
])
const UPDATE_KEYS = Object.freeze([...CREATE_KEYS, 'id', 'version'])

export const DEFINITION_FIELDS = CREATE_KEYS

function parseSourceMapping(text) {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (trimmed.length > 4000) {
    return fieldError('sourceMapping', 'Keep the source mapping under 4,000 characters.')
  }
  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    parsed = undefined
  }
  if (!isPlainObject(parsed)) {
    return fieldError('sourceMapping', 'Enter the source mapping as a JSON object, or leave it blank.')
  }
  return { ok: true, value: parsed }
}

export function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

// One parser for a typed target in display units (rule 7): '' after trimming
// is { ok: true, value: null }; anything over 15 characters or not a plain
// non-negative decimal fails; otherwise the stored number (percent as a
// fraction). A '0' is a value, not an empty cell (rule 3).
export function parseTargetText(unit, text) {
  const trimmed = text.trim()
  if (trimmed === '') return { ok: true, value: null }
  if (trimmed.length > 15 || !TARGET_RE.test(trimmed)) return { ok: false }
  return { ok: true, value: toStoredNumber(unit, Number(trimmed)) }
}

function parseExampleTarget(text, unit) {
  const parsed = parseTargetText(unit, text)
  if (!parsed.ok) {
    return fieldError(
      'exampleTarget',
      'Enter a number of 0 or more, without commas or symbols, or leave it blank.'
    )
  }
  return parsed
}

export function validateDefinition(body, mode) {
  if (!isPlainObject(body)) return GENERIC_ERROR
  if (!hasExactKeys(body, mode === 'update' ? UPDATE_KEYS : CREATE_KEYS)) return GENERIC_ERROR
  if (!CREATE_KEYS.every(k => typeof body[k] === 'string')) return GENERIC_ERROR
  if (mode === 'update') {
    if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return GENERIC_ERROR
    if (!Number.isInteger(body.version) || body.version < 1) return GENERIC_ERROR
  }

  const name = body.name.trim()
  if (name === '') return fieldError('name', 'Enter a KPI name.')
  if (name.length > 120) return fieldError('name', 'Keep the name under 120 characters.')

  const description = body.description.trim()
  if (description === '') {
    return fieldError('description', 'Say what this KPI measures and why it matters.')
  }
  if (description.length > 1000) {
    return fieldError('description', 'Keep the description under 1,000 characters.')
  }

  if (!isOption('kpiType', body.kpiType)) return fieldError('kpiType', 'Choose lead or lag.')
  if (!isOption('unit', body.unit)) return fieldError('unit', 'Choose a unit.')
  if (!isOption('direction', body.direction)) {
    return fieldError('direction', 'Choose whether higher or lower is better.')
  }
  if (!isOption('aggregation', body.aggregation)) {
    return fieldError('aggregation', 'Choose how values combine.')
  }
  if (!isOption('phasing', body.phasing)) {
    return fieldError('phasing', 'Choose how the target is spread.')
  }
  if (!isOption('source', body.source)) return fieldError('source', 'Choose a data source.')

  const mapping = parseSourceMapping(body.sourceMapping)
  if (!mapping.ok) return mapping
  if (mapping.value !== null && body.source === 'manual') {
    return fieldError('sourceMapping', "Manual KPIs don't use a source mapping. Clear this field.")
  }

  if (!isOption('attributionMethod', body.attributionMethod)) {
    return fieldError('attributionMethod', 'Choose who a result counts towards.')
  }
  const note = body.attributionNote.trim()
  if (note.length > 300) {
    return fieldError('attributionNote', 'Keep the note under 300 characters.')
  }

  const target = parseExampleTarget(body.exampleTarget, body.unit)
  if (!target.ok) return target

  const value = {
    name,
    description,
    kpi_type: body.kpiType,
    unit: body.unit,
    direction: body.direction,
    aggregation: body.aggregation,
    phasing: body.phasing,
    source: body.source,
    source_mapping: mapping.value,
    attribution: { method: body.attributionMethod, note: note === '' ? null : note },
    example_target: target.value,
  }
  if (mode === 'update') {
    value.id = body.id
    value.version = body.version
  }
  return { ok: true, value }
}

export function validateStatusChange(body) {
  if (!isPlainObject(body)) return GENERIC_ERROR
  if (!hasExactKeys(body, ['id', 'version', 'status'])) return GENERIC_ERROR
  if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) return GENERIC_ERROR
  if (!Number.isInteger(body.version) || body.version < 1) return GENERIC_ERROR
  if (body.status !== 'published' && body.status !== 'retired') return GENERIC_ERROR
  return { ok: true, value: { id: body.id, version: body.version, status: body.status } }
}

// Structural equality with keys compared as sorted sets, never by serialising
// the raw objects: Postgres returns jsonb with its keys reordered (rule 14).
function sameStructure(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key, i) => key === bKeys[i] && sameStructure(a[key], b[key]))
}

const DEFINITION_COLUMNS = Object.freeze([
  'name',
  'description',
  'kpi_type',
  'unit',
  'direction',
  'aggregation',
  'phasing',
  'source',
  'source_mapping',
  'attribution',
  'example_target',
])

// True when any of the eleven definition columns differs. Numbers compare
// with ===, so null and 0 are different.
export function definitionChanged(currentRow, value) {
  return DEFINITION_COLUMNS.some(column => !sameStructure(currentRow[column], value[column]))
}

export function mapDefinitionDbError(error) {
  const code = error !== null && typeof error === 'object' ? error.code : undefined
  if (code === '23505' || code === 'KP001' || code === 'KP002' || code === 'KP003') {
    return { status: 409, error: STALE_ERROR }
  }
  if (code === '23514') {
    return { status: 400, error: "We couldn't save that. Check the details and try again." }
  }
  if (code === '42501') {
    return { status: 403, error: "We couldn't save that proposal. Ask the admin to check your access." }
  }
  return { status: 500, error: "We couldn't save that. Try again." }
}

export const STALE_MESSAGE = STALE_ERROR
