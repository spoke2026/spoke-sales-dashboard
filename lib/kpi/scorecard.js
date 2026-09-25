// Pure helpers for KPI scorecards (Phase 2b).
//
// Never mutates its inputs. Validators never throw: they return a result the
// route maps to a response. Request bodies are frozen, so a missing or extra
// key, a wrong type, or a bad uuid gives the generic error (rule 6). Explicit
// checks only (=== null, typeof, Number.isFinite, regex); a 0 target is a
// target (rule 3).
//
// Nothing here computes an FY, a quarter, or who may do what (rule 7). Quarter
// data comes from kpi_quarter_months() and permissions from
// kpi_scorecard_actions(); this module only formats and plans.

import { isUuid, parseTargetText, toDisplayNumber, readStoredNumber } from './library.js'
import { isIsoDate, monthStartOf } from './calendar.js'
import { formatMonthYear } from './format.js'

export const NOT_LINKED =
  "Your login isn't linked to a person yet. Ask the admin to add your email on People and teams."
export const STALE = "This scorecard changed since you opened it. Refresh the page to see where it's up to."
export const FORBIDDEN = "You can't make that change to this scorecard."
export const NOT_FOUND = 'That scorecard no longer exists. Refresh the page.'
export const SAVE_ERROR = "We couldn't save that. Try again."

const GENERIC = Object.freeze({ ok: false, status: 400, error: SAVE_ERROR })
const STATUSES = Object.freeze(['draft', 'submitted', 'locked'])
const ACTIONS = Object.freeze(['submit', 'return', 'approve', 'record_board_approval'])
const QUARTER_PARAM_RE = /^(\d{4})-([1-4])$/

export const STATUS_LABELS = Object.freeze({ draft: 'Draft', submitted: 'Submitted', locked: 'Locked' })

export function statusLabel(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? STATUS_LABELS[status] : 'Unknown'
}

// 'Q3 FY27': the FY as its last two digits, zero-padded.
export function formatQuarter(fy, quarter) {
  return `Q${quarter} FY${String(fy % 100).padStart(2, '0')}`
}

// 'October to December 2026' from three sorted 'YYYY-MM-01' strings.
export function formatQuarterMonths(months) {
  if (!Array.isArray(months) || months.length !== 3) return 'Months unavailable'
  const first = formatMonthYear(months[0]).split(' ')[0]
  return `${first} to ${formatMonthYear(months[2])}`
}

export function parseQuarterParam(text) {
  if (typeof text !== 'string') return null
  const match = QUARTER_PARAM_RE.exec(text)
  if (match === null) return null
  const fy = Number(match[1])
  if (fy < 2020 || fy > 2100) return null
  return { fy, quarter: Number(match[2]) }
}

export function quarterParam(fy, quarter) {
  return `${fy}-${quarter}`
}

// Groups kpi_quarter_months() rows into sorted quarter options. The current
// quarter is the one holding today's month; a past quarter's last month is
// before today's month.
export function quarterOptions(rows, today) {
  const todayMonth = monthStartOf(today)
  const byKey = new Map()
  for (const row of rows) {
    const key = quarterParam(row.fy, row.quarter)
    const seen = byKey.get(key)
    if (seen === undefined) byKey.set(key, { fy: row.fy, quarter: row.quarter, months: [row.month] })
    else seen.months.push(row.month)
  }
  return [...byKey.values()]
    .sort((a, b) => a.fy - b.fy || a.quarter - b.quarter)
    .map(({ fy, quarter, months }) => {
      const sorted = [...months].sort()
      return {
        fy,
        quarter,
        months: sorted,
        param: quarterParam(fy, quarter),
        label: `${formatQuarter(fy, quarter)} (${formatQuarterMonths(sorted)})`,
        isCurrent: sorted.includes(todayMonth),
        isPast: sorted[sorted.length - 1] < todayMonth,
      }
    })
}

// The current quarter, else the first one not past, else the last one.
export function currentQuarter(options) {
  const current = options.find(o => o.isCurrent)
  if (current !== undefined) return current
  const upcoming = options.find(o => !o.isPast)
  if (upcoming !== undefined) return upcoming
  return options.length === 0 ? null : options[options.length - 1]
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

export function isCompanyKpi(row) {
  return isPlainObject(row) && isPlainObject(row.attribution) && row.attribution.method === 'company'
}

// "Before approval" warnings (PRD 10.2). Warnings only; approval itself is
// decided by the database (D9).
export function scorecardWarnings({ kpiTypes, missingTargets }) {
  const out = []
  const count = kpiTypes.length
  if (count === 0) {
    out.push('This scorecard has no KPIs yet. Add 5 to 8 from the library.')
  } else if (count < 5) {
    out.push(count === 1 ? 'This scorecard has 1 KPI. Aim for 5 to 8.' : `This scorecard has ${count} KPIs. Aim for 5 to 8.`)
  } else if (count > 8) {
    out.push(`This scorecard has ${count} KPIs. Aim for 5 to 8, so each one gets attention.`)
  }
  const lead = kpiTypes.filter(t => t === 'lead').length
  const lag = kpiTypes.filter(t => t === 'lag').length
  if (count > 0 && lead < lag) {
    out.push(
      `It has fewer lead KPIs (${lead}) than lag KPIs (${lag}). Lead KPIs drive results, so aim for at least as many.`
    )
  }
  if (missingTargets > 0) {
    const head = missingTargets === 1 ? '1 monthly target still empty.' : `${missingTargets} monthly targets still empty.`
    out.push(`${head} Every KPI needs a target for every month before approval. 0 is allowed.`)
  }
  return out
}

// Frozen body: every listed key present, and nothing else (rule 6).
function hasExactKeys(body, keys) {
  if (!isPlainObject(body)) return false
  const present = Object.keys(body)
  return present.length === keys.length && keys.every(k => present.includes(k))
}

function fieldError(field, error) {
  return { ok: false, status: 400, error, field }
}

function isStatus(v) {
  return STATUSES.includes(v)
}

export function validateScorecardCreate(body) {
  if (!hasExactKeys(body, ['personId', 'fy', 'quarter'])) return GENERIC
  if (body.personId !== null && !isUuid(body.personId)) return GENERIC
  if (!Number.isInteger(body.fy) || body.fy < 2020 || body.fy > 2100) return GENERIC
  if (!Number.isInteger(body.quarter) || body.quarter < 1 || body.quarter > 4) return GENERIC
  return { ok: true, value: { personId: body.personId, fy: body.fy, quarter: body.quarter } }
}

const BOARD_DATE_ERROR = "Enter the board meeting date. It can't be in the future."
const BOARD_REFERENCE_ERROR = 'Enter the board meeting reference, for example Board minutes 14 Oct 2026.'
const RETURN_NOTE_ERROR = "Say what needs to change before it's resubmitted."

export function validateLifecycle(body, today) {
  if (!hasExactKeys(body, ['id', 'action', 'expectedStatus', 'note', 'boardMeetingDate'])) return GENERIC
  if (!isUuid(body.id)) return GENERIC
  if (!ACTIONS.includes(body.action)) return GENERIC
  if (!isStatus(body.expectedStatus)) return GENERIC
  if (typeof body.note !== 'string' || typeof body.boardMeetingDate !== 'string') return GENERIC

  const note = body.note.trim()
  if (body.action === 'submit' || body.action === 'approve') {
    if (body.note !== '' || body.boardMeetingDate !== '') return GENERIC
  } else if (body.action === 'return') {
    if (body.boardMeetingDate !== '') return GENERIC
    if (note === '') return fieldError('note', RETURN_NOTE_ERROR)
    if (note.length > 500) return fieldError('note', 'Keep the note under 500 characters.')
  } else {
    if (!isIsoDate(body.boardMeetingDate) || body.boardMeetingDate > today) {
      return fieldError('boardMeetingDate', BOARD_DATE_ERROR)
    }
    if (note === '') return fieldError('note', BOARD_REFERENCE_ERROR)
    if (note.length > 200) return fieldError('note', 'Keep the reference under 200 characters.')
  }

  return {
    ok: true,
    value: {
      id: body.id,
      action: body.action,
      expectedStatus: body.expectedStatus,
      note: note === '' ? null : note,
      boardMeetingDate: body.boardMeetingDate === '' ? null : body.boardMeetingDate,
    },
  }
}

export function validateAssignmentAdd(body) {
  if (!hasExactKeys(body, ['scorecardId', 'kpiId', 'expectedStatus'])) return GENERIC
  if (!isUuid(body.scorecardId) || !isStatus(body.expectedStatus)) return GENERIC
  if (typeof body.kpiId !== 'string') return GENERIC
  if (body.kpiId === '') return fieldError('kpiId', 'Choose a KPI to add.')
  if (!isUuid(body.kpiId)) return GENERIC
  return { ok: true, value: { scorecardId: body.scorecardId, kpiId: body.kpiId, expectedStatus: body.expectedStatus } }
}

export function validateAssignmentRemove(body) {
  if (!hasExactKeys(body, ['assignmentId', 'expectedStatus'])) return GENERIC
  if (!isUuid(body.assignmentId) || !isStatus(body.expectedStatus)) return GENERIC
  return { ok: true, value: { assignmentId: body.assignmentId, expectedStatus: body.expectedStatus } }
}

export function cellField(assignmentId, month) {
  return `cell:${assignmentId}:${month}`
}

function isCell(cell) {
  return (
    hasExactKeys(cell, ['assignmentId', 'month', 'value']) &&
    isUuid(cell.assignmentId) &&
    isIsoDate(cell.month) &&
    cell.month.endsWith('-01') &&
    typeof cell.value === 'string'
  )
}

export function validateTargetSave(body) {
  if (!hasExactKeys(body, ['scorecardId', 'expectedStatus', 'reason', 'cells'])) return GENERIC
  if (!isUuid(body.scorecardId) || !isStatus(body.expectedStatus)) return GENERIC
  if (typeof body.reason !== 'string') return GENERIC
  if (!Array.isArray(body.cells) || body.cells.length < 1 || body.cells.length > 90) return GENERIC
  if (!body.cells.every(isCell)) return GENERIC
  const fields = new Set(body.cells.map(c => cellField(c.assignmentId, c.month)))
  if (fields.size !== body.cells.length) return GENERIC

  const reason = body.reason.trim()
  if (reason.length > 500) return fieldError('reason', 'Keep the reason under 500 characters.')

  return {
    ok: true,
    value: {
      scorecardId: body.scorecardId,
      expectedStatus: body.expectedStatus,
      reason: reason === '' ? null : reason,
      cells: body.cells.map(c => ({ assignmentId: c.assignmentId, month: c.month, value: c.value })),
    },
  }
}

// Compared as numbers in display units, never as text or in stored units, so
// '20.50' matches 20.5 and '33.0' matches a stored 0.33 (rule 14).
export function targetUnchanged(unit, text, stored) {
  return typeof stored === 'number' && Number.isFinite(stored) && Number(text.trim()) === toDisplayNumber(unit, stored)
}

// Turns the submitted cells into kpi_target rows to insert.
//   unitByAssignment: Map assignmentId -> the pinned KPI version's unit
//   currentByCell: Map cellField -> the current stored value, missing when
//     the cell has no target yet (read through readStoredNumber here, so a
//     numeric string from PostgREST compares the same as a number, rule 11)
// Unchanged cells are skipped, so a resave never mints identical versions.
export function planTargetInserts({ cells, unitByAssignment, currentByCell, reason }) {
  const rows = []
  for (const cell of cells) {
    if (!unitByAssignment.has(cell.assignmentId)) return GENERIC
    const unit = unitByAssignment.get(cell.assignmentId)
    const field = cellField(cell.assignmentId, cell.month)
    const parsed = parseTargetText(unit, cell.value)
    if (!parsed.ok) return fieldError(field, 'Enter a number of 0 or more, without commas or symbols.')
    const hasCurrent = currentByCell.has(field)
    if (parsed.value === null) {
      if (hasCurrent) return fieldError(field, "Targets can't be cleared once saved. Enter 0 instead.")
      continue
    }
    if (hasCurrent && targetUnchanged(unit, cell.value, readStoredNumber(currentByCell.get(field)))) continue
    rows.push({ assignment_id: cell.assignmentId, month: cell.month, value: parsed.value, change_reason: reason })
  }
  if (rows.length === 0) return { ok: false, status: 400, error: 'Nothing has changed. Edit a target or cancel.' }
  return { ok: true, rows }
}

function mapped(status, error, field) {
  return field === undefined ? { status, error } : { status, error, field }
}

// Database error → fixed copy. Matches error.code with === only, never the
// message text. Raw errors are logged by the caller and never returned.
export function mapScorecardDbError(context, error) {
  const code = isPlainObject(error) ? error.code : undefined
  if (code === '23505') {
    if (context === 'create') {
      return mapped(409, "There's already a scorecard for this quarter. Open it from the scorecards list.", 'quarter')
    }
    if (context === 'assignment') return mapped(409, 'That KPI is already on this scorecard.', 'kpiId')
    return mapped(409, STALE)
  }
  if (code === '23503') return mapped(400, 'That person or KPI no longer exists. Refresh the page.')
  if (code === '23514' || code === 'KS009' || code === 'KS011') return mapped(400, SAVE_ERROR)
  if (code === '42501' || code === 'KS001') return mapped(403, FORBIDDEN)
  if (code === 'KS002') {
    return mapped(400, 'Every KPI needs a target for every month before approval. Fill in the empty months, or enter 0.')
  }
  if (code === 'KS003') return mapped(400, 'Add at least one KPI first.')
  if (code === 'KS004') return mapped(403, "You can't approve your own scorecard. Record the board's approval instead.")
  if (code === 'KS005') return mapped(400, 'Board approval is only for the company scorecard and your own scorecard.')
  if (code === 'KS006') return mapped(409, "That KPI isn't available for new scorecards. Pick a published KPI.", 'kpiId')
  if (code === 'KS007') {
    return mapped(
      400,
      "This person doesn't have an individual scorecard. Check they're active and set to Individual on People and teams."
    )
  }
  if (code === 'KS008') return mapped(400, "The working-day calendar doesn't cover that quarter.", 'quarter')
  if (code === 'KS010') return mapped(400, 'Say why these targets are changing. The reason is saved in the audit log.', 'reason')
  if (code === 'KS012') return mapped(400, RETURN_NOTE_ERROR, 'note')
  if (code === 'KS013') return mapped(400, BOARD_DATE_ERROR, 'boardMeetingDate')
  if (code === 'KS014') return mapped(400, BOARD_REFERENCE_ERROR, 'note')
  return mapped(500, SAVE_ERROR)
}
