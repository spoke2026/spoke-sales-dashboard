export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { saveTargets, saveSalesBudget } from '@/lib/supabase'

export async function POST(request) {
  try {
    const { month, targets, salesBudget } = await request.json()
    if (!month || !targets) {
      return NextResponse.json({ error: 'Missing month or targets' }, { status: 400 })
    }
    const [edOk, markOk, budgetOk] = await Promise.all([
      saveTargets(month, 'Ed',   targets.Ed.calls,   targets.Ed.visits,   targets.Ed.pipeline),
      saveTargets(month, 'Mark', targets.Mark.calls, targets.Mark.visits, targets.Mark.pipeline),
      salesBudget ? saveSalesBudget(month, salesBudget) : Promise.resolve(true),
    ])
    if (!edOk || !markOk || !budgetOk) {
      return NextResponse.json({ error: 'Failed to save targets' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}