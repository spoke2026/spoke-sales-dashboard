export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateTeam, mapDbError } from '@/lib/kpi/admin'

const SAVE_ERROR = "We couldn't save that. Try again."

export async function POST(request) {
  try {
    const gate = await requireAdmin()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateTeam(body, 'create')
    if (!result.ok) {
      return errorResponse(result)
    }

    const { data, error } = await supabase
      .from('kpi_team')
      .insert({ name: result.value.name })
      .select()
      .single()

    if (error) {
      console.error(error)
      const mapped = mapDbError('team', error)
      return errorResponse(mapped)
    }

    return NextResponse.json({ team: data }, { status: 201 })
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

    const result = validateTeam(body, 'update')
    if (!result.ok) {
      return errorResponse(result)
    }

    const { data, error } = await supabase
      .from('kpi_team')
      .update({ name: result.value.name, active: result.value.active })
      .eq('id', result.value.id)
      .select()

    if (error) {
      console.error(error)
      const mapped = mapDbError('team', error)
      return errorResponse(mapped)
    }

    if (data.length === 0) {
      return NextResponse.json(
        { error: 'That team no longer exists. Refresh the page.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ team: data[0] }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
