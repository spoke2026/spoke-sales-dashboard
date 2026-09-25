export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireLinkedUser, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateTargetSave, planTargetInserts, cellField, mapScorecardDbError, NOT_FOUND, STALE, SAVE_ERROR } from '@/lib/kpi/scorecard'
import { readStoredNumber } from '@/lib/kpi/library'

export async function POST(request) {
  try {
    const gate = await requireLinkedUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateTargetSave(body)
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: scorecards, error: scorecardError } = await supabase
      .from('kpi_scorecard')
      .select('id, status')
      .eq('id', value.scorecardId)

    if (scorecardError) {
      console.error(scorecardError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }
    if (scorecards.length === 0) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
    }
    if (scorecards[0].status !== value.expectedStatus) {
      return NextResponse.json({ error: STALE }, { status: 409 })
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from('kpi_assignment')
      .select('id, kpi_definition_id, kpi_version')
      .eq('scorecard_id', value.scorecardId)

    if (assignmentsError) {
      console.error(assignmentsError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const unitByAssignment = new Map()
    if (assignments.length > 0) {
      const ids = [...new Set(assignments.map(a => a.kpi_definition_id))]
      const { data: defs, error: defsError } = await supabase
        .from('kpi_definition')
        .select('id, version, unit')
        .in('id', ids)

      if (defsError) {
        console.error(defsError)
        return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
      }

      const unitByDef = new Map()
      for (const row of defs) {
        unitByDef.set(`${row.id}:${row.version}`, row.unit)
      }
      for (const a of assignments) {
        const unit = unitByDef.get(`${a.kpi_definition_id}:${a.kpi_version}`)
        if (unit !== undefined) unitByAssignment.set(a.id, unit)
      }
    }

    const { data: currentTargets, error: currentError } = await supabase.rpc('kpi_current_targets', {
      p_scorecard_id: value.scorecardId,
    })

    if (currentError) {
      console.error(currentError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const currentByCell = new Map()
    for (const row of currentTargets) {
      currentByCell.set(cellField(row.assignment_id, row.month), readStoredNumber(row.value))
    }

    const plan = planTargetInserts({
      cells: value.cells,
      unitByAssignment,
      currentByCell,
      reason: value.reason,
    })

    if (!plan.ok) {
      return errorResponse(plan)
    }

    const { data, error } = await supabase.from('kpi_target').insert(plan.rows).select()

    if (error) {
      console.error(error)
      return errorResponse(mapScorecardDbError('targets', error))
    }

    return NextResponse.json({ saved: data.length }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
