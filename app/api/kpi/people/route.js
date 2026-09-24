export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validatePerson, wouldCreateManagerCycle, mapDbError } from '@/lib/kpi/admin'

const SAVE_ERROR = "We couldn't save that. Try again."
const CYCLE_ERROR = 'That line manager already reports to this person. Pick someone else.'

async function checkManagerCycle(supabase, personId, managerId) {
  if (managerId === null) return null
  const { data, error } = await supabase.from('kpi_person').select('id, manager_id')
  if (error) {
    console.error(error)
    return { status: 500, error: SAVE_ERROR }
  }
  if (wouldCreateManagerCycle(data, personId, managerId)) {
    return { status: 400, field: 'managerId', error: CYCLE_ERROR }
  }
  return null
}

export async function POST(request) {
  try {
    const gate = await requireAdmin()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validatePerson(body, 'create')
    if (!result.ok) {
      return errorResponse(result)
    }

    const cycleError = await checkManagerCycle(supabase, null, result.value.managerId)
    if (cycleError) {
      return errorResponse(cycleError)
    }

    const { data, error } = await supabase
      .from('kpi_person')
      .insert({
        full_name: result.value.fullName,
        email: result.value.email,
        primary_team_id: result.value.primaryTeamId,
        manager_id: result.value.managerId,
        is_contractor: result.value.isContractor,
        scorecard_type: result.value.scorecardType,
      })
      .select()
      .single()

    if (error) {
      console.error(error)
      const mapped = mapDbError('person', error)
      return errorResponse(mapped)
    }

    return NextResponse.json({ person: data }, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}

export async function PATCH(request) {
  try {
    const gate = await requireAdmin()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validatePerson(body, 'update')
    if (!result.ok) {
      return errorResponse(result)
    }

    const cycleError = await checkManagerCycle(supabase, result.value.id, result.value.managerId)
    if (cycleError) {
      return errorResponse(cycleError)
    }

    const { data, error } = await supabase
      .from('kpi_person')
      .update({
        full_name: result.value.fullName,
        email: result.value.email,
        primary_team_id: result.value.primaryTeamId,
        manager_id: result.value.managerId,
        is_contractor: result.value.isContractor,
        scorecard_type: result.value.scorecardType,
        active: result.value.active,
      })
      .eq('id', result.value.id)
      .select()

    if (error) {
      console.error(error)
      const mapped = mapDbError('person', error)
      return errorResponse(mapped)
    }

    if (data.length === 0) {
      return NextResponse.json(
        { error: 'That person no longer exists. Refresh the page.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ person: data[0] }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
