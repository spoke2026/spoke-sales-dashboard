export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireLinkedUser, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateLifecycle, mapScorecardDbError, NOT_FOUND, STALE, FORBIDDEN, SAVE_ERROR } from '@/lib/kpi/scorecard'
import { todayInAuckland } from '@/lib/kpi/calendar'

function updatePayload(value) {
  if (value.action === 'submit') return { status: 'submitted' }
  if (value.action === 'return') return { status: 'draft', return_note: value.note }
  if (value.action === 'approve') return { status: 'locked', approval_kind: 'standard' }
  return {
    status: 'locked',
    approval_kind: 'board',
    board_reference: value.note,
    board_meeting_date: value.boardMeetingDate,
  }
}

export async function PATCH(request) {
  try {
    const gate = await requireLinkedUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateLifecycle(body, todayInAuckland())
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: rows, error: fetchError } = await supabase
      .from('kpi_scorecard')
      .select('id, status')
      .eq('id', value.id)

    if (fetchError) {
      console.error(fetchError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
    }

    if (rows[0].status !== value.expectedStatus) {
      return NextResponse.json({ error: STALE }, { status: 409 })
    }

    const { data, error } = await supabase
      .from('kpi_scorecard')
      .update(updatePayload(value))
      .eq('id', value.id)
      .eq('status', value.expectedStatus)
      .select()

    if (error) {
      console.error(error)
      return errorResponse(mapScorecardDbError('lifecycle', error))
    }

    if (data.length === 0) {
      const { data: recheck, error: recheckError } = await supabase
        .from('kpi_scorecard')
        .select('id, status')
        .eq('id', value.id)

      if (recheckError) {
        console.error(recheckError)
        return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
      }

      if (recheck.length === 0 || recheck[0].status !== value.expectedStatus) {
        return NextResponse.json({ error: STALE }, { status: 409 })
      }
      return NextResponse.json({ error: FORBIDDEN }, { status: 403 })
    }

    return NextResponse.json({ scorecard: data[0] }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
