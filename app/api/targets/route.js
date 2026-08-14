export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { saveTargets, saveSalesBudget } from '@/lib/targets'

export async function POST(request) {
  try {
    const supabase = await createClient()

    // Must be signed in.
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    // Admin check — friendly-error layer on top of RLS. Fails CLOSED: any error
    // from rpc('is_admin') (including the deploy window before is_admin() exists)
    // is treated as not-admin. RLS remains the hard boundary regardless.
    const { data: isAdmin, error: adminError } = await supabase.rpc('is_admin')
    if (adminError || isAdmin !== true) {
      return NextResponse.json(
        { error: 'You do not have permission to edit targets.' },
        { status: 403 }
      )
    }

    const { month, targets, salesBudget } = await request.json()
    if (!month || !targets) {
      return NextResponse.json({ error: 'Missing month or targets' }, { status: 400 })
    }

    // Writes run through the authenticated client so RLS enforces admin-only.
    const [edOk, markOk, budgetOk] = await Promise.all([
      saveTargets(supabase, month, 'Ed',   targets.Ed.calls,   targets.Ed.visits,   targets.Ed.pipeline),
      saveTargets(supabase, month, 'Mark', targets.Mark.calls, targets.Mark.visits, targets.Mark.pipeline),
      salesBudget ? saveSalesBudget(supabase, month, salesBudget) : Promise.resolve(true),
    ])

    if (!edOk || !markOk || !budgetOk) {
      return NextResponse.json({ error: 'Failed to save targets' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
