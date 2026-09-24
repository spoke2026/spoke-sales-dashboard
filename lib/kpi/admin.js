// Pure validators and small helpers for the KPI admin write path.
//
// No imports. Validators never throw — they return a result object the
// route maps to a response. Request bodies are frozen: any key outside the
// listed set, or a missing key, fails validation (rule 6). Explicit type checks throughout;
// never truthiness on booleans (rule 3).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const GENERIC_ERROR = { ok: false, status: 400, error: "We couldn't save that. Try again." }

function isPlainObject(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body)
}

// Frozen body: every listed key present, and nothing else (rule 6).
function hasExactKeys(body, keys) {
  const present = Object.keys(body)
  return present.length === keys.length && keys.every(k => present.includes(k))
}

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v)
}

function isNullableUuid(v) {
  return v === null || isUuid(v)
}

function fieldError(field, error) {
  return { ok: false, status: 400, field, error }
}

function isIsoDate(s) {
  if (typeof s !== 'string' || !ISO_DATE_RE.test(s)) return false
  const y = Number(s.slice(0, 4))
  const m = Number(s.slice(5, 7))
  const d = Number(s.slice(8, 10))
  const ms = Date.UTC(y, m - 1, d)
  const check = new Date(ms)
  const rebuilt =
    String(check.getUTCFullYear()).padStart(4, '0') +
    '-' +
    String(check.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(check.getUTCDate()).padStart(2, '0')
  return rebuilt === s
}

function normaliseTeamName(value) {
  if (typeof value !== 'string') return GENERIC_ERROR
  const trimmed = value.trim()
  if (trimmed.length === 0) return fieldError('name', 'Enter a team name.')
  if (trimmed.length > 80) {
    return fieldError('name', 'Keep the team name under 80 characters.')
  }
  return { ok: true, value: trimmed }
}

function normaliseFullName(value) {
  if (typeof value !== 'string') return GENERIC_ERROR
  const trimmed = value.trim()
  if (trimmed.length === 0) return fieldError('fullName', "Enter the person's full name.")
  if (trimmed.length > 120) {
    return fieldError('fullName', 'Keep the name under 120 characters.')
  }
  return { ok: true, value: trimmed }
}

function normaliseEmail(value) {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string') return GENERIC_ERROR
  const trimmed = value.trim().toLowerCase()
  if (trimmed === '') return { ok: true, value: null }
  if (!EMAIL_RE.test(trimmed)) {
    return fieldError('email', 'Enter a valid email address.')
  }
  return { ok: true, value: trimmed }
}

export function validateTeam(body, mode) {
  if (!isPlainObject(body)) return GENERIC_ERROR

  if (mode === 'create') {
    if (!hasExactKeys(body, ['name'])) return GENERIC_ERROR
    const name = normaliseTeamName(body.name)
    if (!name.ok) return name
    return { ok: true, value: { name: name.value } }
  }

  // mode === 'update'
  if (!hasExactKeys(body, ['id', 'name', 'active'])) return GENERIC_ERROR
  if (!isUuid(body.id)) return GENERIC_ERROR
  if (typeof body.active !== 'boolean') return GENERIC_ERROR
  const name = normaliseTeamName(body.name)
  if (!name.ok) return name
  return { ok: true, value: { id: body.id, name: name.value, active: body.active } }
}

export function validatePerson(body, mode) {
  if (!isPlainObject(body)) return GENERIC_ERROR

  const createKeys = ['fullName', 'email', 'primaryTeamId', 'managerId', 'isContractor', 'scorecardType']
  const updateKeys = [...createKeys, 'id', 'active']

  if (mode === 'create') {
    if (!hasExactKeys(body, createKeys)) return GENERIC_ERROR
  } else {
    if (!hasExactKeys(body, updateKeys)) return GENERIC_ERROR
    if (!isUuid(body.id)) return GENERIC_ERROR
    if (typeof body.active !== 'boolean') return GENERIC_ERROR
  }

  const fullName = normaliseFullName(body.fullName)
  if (!fullName.ok) return fullName

  const email = normaliseEmail(body.email)
  if (!email.ok) return email

  if (!isNullableUuid(body.primaryTeamId)) return GENERIC_ERROR
  if (!isNullableUuid(body.managerId)) return GENERIC_ERROR

  if (typeof body.isContractor !== 'boolean') return GENERIC_ERROR

  if (body.scorecardType !== 'individual' && body.scorecardType !== 'company_only') {
    return fieldError('scorecardType', 'Choose a scorecard type.')
  }

  if (mode === 'update' && body.managerId !== null && body.managerId === body.id) {
    return fieldError('managerId', "A person can't be their own line manager.")
  }

  const value = {
    fullName: fullName.value,
    email: email.value,
    primaryTeamId: body.primaryTeamId,
    managerId: body.managerId,
    isContractor: body.isContractor,
    scorecardType: body.scorecardType,
  }
  if (mode === 'update') {
    value.id = body.id
    value.active = body.active
  }
  return { ok: true, value }
}

export function validateClosure(body, mode) {
  if (!isPlainObject(body)) return GENERIC_ERROR

  if (mode === 'delete') {
    if (!hasExactKeys(body, ['date'])) return GENERIC_ERROR
    if (!isIsoDate(body.date)) return fieldError('date', 'Pick a date.')
    return { ok: true, value: { date: body.date } }
  }

  // mode === 'create'
  if (!hasExactKeys(body, ['date', 'reason'])) return GENERIC_ERROR
  if (!isIsoDate(body.date)) return fieldError('date', 'Pick a date.')

  if (typeof body.reason !== 'string') return GENERIC_ERROR
  const reason = body.reason.trim()
  if (reason.length === 0) {
    return fieldError('reason', 'Enter a reason, for example Christmas shutdown.')
  }
  if (reason.length > 120) {
    return fieldError('reason', 'Keep the reason under 120 characters.')
  }

  return { ok: true, value: { date: body.date, reason } }
}

export function wouldCreateManagerCycle(people, personId, managerId) {
  if (managerId === personId) return true
  const byId = new Map(people.map(p => [p.id, p.manager_id]))
  let current = managerId
  let steps = 0
  while (current !== null && steps < people.length) {
    if (current === personId) return true
    current = byId.get(current) ?? null
    steps++
  }
  return false
}

export function mapDbError(entity, error) {
  const code = error && error.code

  if (code === '23505') {
    if (entity === 'team') {
      return { status: 409, error: 'A team with that name already exists.', field: 'name' }
    }
    if (entity === 'person') {
      return { status: 409, error: 'A person with that email already exists.', field: 'email' }
    }
    return { status: 409, error: 'That date is already a closure.', field: 'date' }
  }

  if (code === '23503') {
    return { status: 400, error: 'That team or person no longer exists. Refresh the page.' }
  }

  if (code === '23514') {
    return { status: 400, error: "We couldn't save that. Check the details and try again." }
  }

  return { status: 500, error: "We couldn't save that. Try again." }
}
