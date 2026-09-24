export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateStatusChange, canTransition, latestVersions, mapDefinitionDbError } from '@/lib/kpi/library'

const SAVE_ERROR = "We couldn't save that. Try again."

export async function PATCH(request) {
  try {
    const gate = await requireAdmin()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateStatusChange(body)
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: rows, error: fetchError } = await supabase
      .from('kpi_definition')
      .select('id, version, status')
      .eq('id', value.id)

    if (fetchError) {
      console.error(fetchError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'That KPI no longer exists. Refresh the page.' },
        { status: 404 }
      )
    }

    const [current] = latestVersions(rows)

    if (value.version !== current.version) {
      return errorResponse(mapDefinitionDbError({ code: 'KP002' }))
    }

    if (!canTransition(current.status, value.status)) {
      return NextResponse.json(
        { error: "That change isn't available for this KPI. Refresh the page." },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('kpi_definition')
      .update({ status: value.status })
      .eq('id', value.id)
      .eq('version', current.version)
      .select()

    if (error) {
      console.error(error)
      const mapped = mapDefinitionDbError(error)
      return errorResponse(mapped)
    }

    if (data.length === 0) {
      return errorResponse(mapDefinitionDbError({ code: 'KP002' }))
    }

    return NextResponse.json({ definition: data[0] }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
