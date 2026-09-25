export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireLinkedUser, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import {
  validateEntrySave,
  planEntryUpserts,
  mapEntryDbError,
  entryField,
  ENTRY_FORBIDDEN,
} from '@/lib/kpi/entry'
import { SAVE_ERROR } from '@/lib/kpi/scorecard'
import { readStoredNumber } from '@/lib/kpi/library'
import { addDays, todayInAuckland } from '@/lib/kpi/calendar'

export async function POST(request) {
  try {
    const gate = await requireLinkedUser()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateEntrySave(body)
    if (!result.ok) {
      return errorResponse(result)
    }
    const { value } = result

    const { data: entryPeople, error: entryPeopleError } = await supabase.rpc('kpi_entry_people')
    if (entryPeopleError) {
      console.error(entryPeopleError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }
    if (!entryPeople.includes(value.personId)) {
      return NextResponse.json({ error: ENTRY_FORBIDDEN }, { status: 403 })
    }

    const weekEnd = addDays(value.weekStart, 6)

    const { data: cells, error: cellsError } = await supabase.rpc('kpi_entry_cells', {
      p_person_id: value.personId,
      p_from: value.weekStart,
      p_to: weekEnd,
    })
    if (cellsError) {
      console.error(cellsError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const cellInfo = new Map()
    const kpiIds = new Set()
    for (const cell of cells) {
      cellInfo.set(entryField(cell.kpi_definition_id, cell.date), {
        canWrite: cell.can_write,
        kpiVersion: cell.kpi_version,
      })
      kpiIds.add(cell.kpi_definition_id)
    }
    for (const cell of value.cells) {
      kpiIds.add(cell.kpiId)
    }

    const { data: defRows, error: defError } = await supabase
      .from('kpi_definition')
      .select('id, version, unit, aggregation')
      .in('id', [...kpiIds])
    if (defError) {
      console.error(defError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const definitions = new Map()
    for (const row of defRows) {
      definitions.set(`${row.id}:${row.version}`, { unit: row.unit, aggregation: row.aggregation })
    }

    const { data: entryRows, error: entryError } = await supabase
      .from('kpi_manual_entry')
      .select('kpi_definition_id, date, value, numerator, denominator')
      .eq('person_id', value.personId)
      .gte('date', value.weekStart)
      .lte('date', weekEnd)
    if (entryError) {
      console.error(entryError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    const current = new Map()
    for (const row of entryRows) {
      current.set(entryField(row.kpi_definition_id, row.date), {
        value: readStoredNumber(row.value),
        numerator: readStoredNumber(row.numerator),
        denominator: readStoredNumber(row.denominator),
      })
    }

    const plan = planEntryUpserts({
      personId: value.personId,
      cells: value.cells,
      cellInfo,
      definitions,
      current,
      today: todayInAuckland(),
    })

    if (!plan.ok) {
      return errorResponse(plan)
    }

    const { data, error } = await supabase
      .from('kpi_manual_entry')
      .upsert(plan.rows, { onConflict: 'person_id,kpi_definition_id,date' })
      .select()

    if (error) {
      console.error(error)
      return errorResponse(mapEntryDbError(error))
    }

    return NextResponse.json({ saved: data.length }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
