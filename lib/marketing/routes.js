// Shared plumbing for the Marketing write routes. Every write runs through the
// signed-in user's Supabase client after requireAdmin(), so RLS stays the real
// boundary and only public.is_admin() can change marketing data.

import { requireAdmin, readJsonBody, errorResponse } from '../kpi/requireAdmin.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const SAVE_ERROR = "We couldn't save that. Try again."

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}

// Gate, parse and (optionally) check the id in one step.
export async function adminRequest(request, { needsId = false } = {}) {
  const gate = await requireAdmin()
  if (gate.denied) return { denied: gate.denied }
  const body = await readJsonBody(request)
  if (body === null) return { denied: errorResponse({ status: 400, error: SAVE_ERROR }) }
  if (needsId && !isUuid(body.id)) return { denied: errorResponse({ status: 400, error: SAVE_ERROR }) }
  return { supabase: gate.supabase, body }
}

export function invalid(result) {
  return errorResponse({ status: 400, error: result.error, field: result.field })
}

// Maps a Supabase write result to a response. 23505 is a unique clash.
export function writeResult({ data, error }, { duplicateField, duplicateMessage } = {}) {
  if (error) {
    if (error.code === '23505' && duplicateMessage) {
      return errorResponse({ status: 409, error: duplicateMessage, field: duplicateField })
    }
    console.error('Marketing write failed', error)
    return errorResponse({ status: 500, error: SAVE_ERROR })
  }
  if (Array.isArray(data) && data.length === 0) {
    return errorResponse({ status: 404, error: "That row doesn't exist any more. Refresh the page." })
  }
  return Response.json({ ok: true })
}
