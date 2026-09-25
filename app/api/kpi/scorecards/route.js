export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireLinkedUser, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateScorecardCreate, quarterOptions, mapScorecardDbError, SAVE_ERROR } from '@/lib/kpi/scorecard'
import { todayInAuckland } from '@/lib/kpi/calendar'

export async function POST(request) {
  try {
    const gate = await requireLinkedUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateScorecardCreate(body)
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: rows, error: quarterError } = await supabase.rpc('kpi_quarter_months')
    if (quarterError) {
      console.error(quarterError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const options = quarterOptions(rows, todayInAuckland())
    const option = options.find(o => o.fy === value.fy && o.quarter === value.quarter)
    if (option === undefined) {
      return errorResponse(mapScorecardDbError('create', { code: 'KS008' }))
    }
    if (option.isPast) {
      return NextResponse.json(
        { error: 'Pick this quarter or a later one.', field: 'quarter' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('kpi_scorecard')
      .insert({ person_id: value.personId, fy: value.fy, quarter: value.quarter })
      .select()
      .single()

    if (error) {
      console.error(error)
      return errorResponse(mapScorecardDbError('create', error))
    }

    return NextResponse.json({ scorecard: data }, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
