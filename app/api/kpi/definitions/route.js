export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireUser, requireAdmin, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateDefinition, latestVersions, definitionChanged, mapDefinitionDbError } from '@/lib/kpi/library'

const SAVE_ERROR = "We couldn't save that. Try again."
const NAME_TAKEN_ERROR = { error: 'A KPI with that name already exists.', field: 'name' }

function nameTaken(currentRows, name, excludeId) {
  const target = name.trim().toLowerCase()
  return currentRows.some(row => row.id !== excludeId && row.name.trim().toLowerCase() === target)
}

export async function POST(request) {
  try {
    const gate = await requireUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateDefinition(body, 'create')
    if (!result.ok) {
      return errorResponse(result)
    }

    const { data: rows, error: fetchError } = await supabase
      .from('kpi_definition')
      .select('id, version, name')

    if (fetchError) {
      console.error(fetchError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const current = latestVersions(rows)
    if (nameTaken(current, result.value.name, undefined)) {
      return NextResponse.json(NAME_TAKEN_ERROR, { status: 409 })
    }

    const { data, error } = await supabase
      .from('kpi_definition')
      .insert(result.value)
      .select()
      .single()

    if (error) {
      console.error(error)
      const mapped = mapDefinitionDbError(error)
      return errorResponse(mapped)
    }

    return NextResponse.json({ definition: data }, { status: 201 })
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

    const result = validateDefinition(body, 'update')
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: rows, error: fetchError } = await supabase
      .from('kpi_definition')
      .select('*')
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

    if (current.status === 'retired') {
      return NextResponse.json(
        { error: "Retired KPIs can't be edited." },
        { status: 400 }
      )
    }

    if (!definitionChanged(current, value)) {
      return NextResponse.json(
        { error: 'Nothing has changed. Edit a field or cancel.' },
        { status: 400 }
      )
    }

    const { data: allRows, error: allError } = await supabase
      .from('kpi_definition')
      .select('id, version, name')

    if (allError) {
      console.error(allError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const allCurrent = latestVersions(allRows)
    if (nameTaken(allCurrent, value.name, value.id)) {
      return NextResponse.json(NAME_TAKEN_ERROR, { status: 409 })
    }

    const insertRow = {
      id: value.id,
      version: current.version + 1,
      status: current.status,
      name: value.name,
      description: value.description,
      kpi_type: value.kpi_type,
      unit: value.unit,
      direction: value.direction,
      aggregation: value.aggregation,
      phasing: value.phasing,
      source: value.source,
      source_mapping: value.source_mapping,
      attribution: value.attribution,
      example_target: value.example_target,
    }

    const { data, error } = await supabase
      .from('kpi_definition')
      .insert(insertRow)
      .select()
      .single()

    if (error) {
      console.error(error)
      const mapped = mapDefinitionDbError(error)
      return errorResponse(mapped)
    }

    return NextResponse.json({ definition: data }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
