// Auth gates for the KPI API routes. Mirrors app/api/targets/route.js
// exactly: getUser → 401, rpc('is_admin') with any error treated as
// not-admin → 403. rpc('is_admin') is a friendly-error layer only; RLS is
// the real security boundary.
//
// requireUser() is the signed-in-only gate (used by the KPI definitions POST,
// which any signed-in user may call). requireAdmin() calls requireUser() and
// layers the admin check on top, so both gates share one getUser block (D15,
// rule 7).

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function requireUser() {
  const supabase = await createClient()

  let user = null
  try {
    const result = await supabase.auth.getUser()
    user = result.data.user
    if (result.error) user = null
  } catch (error) {
    user = null
  }

  if (!user) {
    return {
      denied: NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 }),
    }
  }

  return { supabase, user }
}

export async function requireAdmin() {
  const gate = await requireUser()
  if (gate.denied) return gate
  const { supabase, user } = gate

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
  if (adminError || isAdmin !== true) {
    return {
      denied: NextResponse.json(
        { error: 'Only the admin can make changes here.' },
        { status: 403 }
      ),
    }
  }

  return { supabase, user }
}

// Parses the request body. Anything that isn't a JSON object gives null, which
// the routes turn into the generic 400. One copy for all three KPI routes.
export async function readJsonBody(request) {
  try {
    const body = await request.json()
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return null
    return body
  } catch (error) {
    return null
  }
}

// Every error body is { error } or { error, field }. Never raw database text.
export function errorResponse({ status, error, field }) {
  return NextResponse.json(field === undefined ? { error } : { error, field }, { status })
}
