export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireLinkedUser, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import {
  validateAssignmentAdd,
  validateAssignmentRemove,
  isCompanyKpi,
  mapScorecardDbError,
  NOT_FOUND,
  STALE,
  FORBIDDEN,
  SAVE_ERROR,
} from '@/lib/kpi/scorecard'
import { latestVersions } from '@/lib/kpi/library'

async function readScorecard(supabase, id) {
  const { data, error } = await supabase.from('kpi_scorecard').select('id, person_id, status').eq('id', id)
  return { data, error }
}

export async function POST(request) {
  try {
    const gate = await requireLinkedUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateAssignmentAdd(body)
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: scorecards, error: scorecardError } = await readScorecard(supabase, value.scorecardId)
    if (scorecardError) {
      console.error(scorecardError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }
    if (scorecards.length === 0) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
    }
    const scorecard = scorecards[0]
    if (scorecard.status !== value.expectedStatus) {
      return NextResponse.json({ error: STALE }, { status: 409 })
    }

    const { data: defRows, error: defError } = await supabase
      .from('kpi_definition')
      .select('*')
      .eq('id', value.kpiId)

    if (defError) {
      console.error(defError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    if (defRows.length === 0) {
      return NextResponse.json(
        { error: 'That KPI no longer exists. Refresh the page.', field: 'kpiId' },
        { status: 404 }
      )
    }

    const [current] = latestVersions(defRows)

    if (current.status !== 'published') {
      return errorResponse(mapScorecardDbError('assignment', { code: 'KS006' }))
    }

    const company = isCompanyKpi(current)
    if (scorecard.person_id === null && !company) {
      return NextResponse.json(
        { error: 'Only company KPIs can go on the company scorecard.', field: 'kpiId' },
        { status: 400 }
      )
    }
    if (scorecard.person_id !== null && company) {
      return NextResponse.json(
        { error: 'Company KPIs can only go on the company scorecard.', field: 'kpiId' },
        { status: 400 }
      )
    }

    const { data: existingAssignments, error: assignmentsError } = await supabase
      .from('kpi_assignment')
      .select('sort_order')
      .eq('scorecard_id', value.scorecardId)

    if (assignmentsError) {
      console.error(assignmentsError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const nextSortOrder =
      existingAssignments.length === 0 ? 0 : 1 + Math.max(...existingAssignments.map(a => a.sort_order))

    const { data, error } = await supabase
      .from('kpi_assignment')
      .insert({
        scorecard_id: value.scorecardId,
        kpi_definition_id: current.id,
        kpi_version: current.version,
        sort_order: nextSortOrder,
      })
      .select()
      .single()

    if (error) {
      console.error(error)
      return errorResponse(mapScorecardDbError('assignment', error))
    }

    return NextResponse.json({ assignment: data }, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const gate = await requireLinkedUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateAssignmentRemove(body)
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: rows, error: fetchError } = await supabase
      .from('kpi_assignment')
      .select('id, scorecard_id')
      .eq('id', value.assignmentId)

    if (fetchError) {
      console.error(fetchError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'That KPI is no longer on this scorecard. Refresh the page.' },
        { status: 404 }
      )
    }

    const { data: scorecards, error: scorecardError } = await readScorecard(supabase, rows[0].scorecard_id)
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

    const { data, error } = await supabase.rpc('kpi_remove_assignment', {
      p_assignment_id: value.assignmentId,
    })

    if (error) {
      console.error(error)
      return errorResponse(mapScorecardDbError('remove', error))
    }

    if (data === 0) {
      return NextResponse.json({ error: FORBIDDEN }, { status: 403 })
    }

    return NextResponse.json({ removed: value.assignmentId }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
