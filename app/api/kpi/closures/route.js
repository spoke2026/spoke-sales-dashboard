export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireAdmin, readJsonBody, errorResponse } from '@/lib/kpi/requireAdmin'
import { validateClosure, mapDbError } from '@/lib/kpi/admin'
import { formatLongDate } from '@/lib/kpi/format'

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

    const result = validateClosure(body, 'create')
    if (!result.ok) {
      return errorResponse(result)
    }

    const { date, reason } = result.value

    const { data: dayRow, error: dayError } = await supabase
      .from('kpi_calendar_day')
      .select('date, is_working_day')
      .eq('date', date)
      .maybeSingle()

    if (dayError) {
      console.error(dayError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    if (!dayRow) {
      const [{ data: minRow, error: minError }, { data: maxRow, error: maxError }] = await Promise.all([
        supabase.from('kpi_calendar_day').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
        supabase.from('kpi_calendar_day').select('date').order('date', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (minError || maxError || !minRow || !maxRow) {
        console.error(minError || maxError)
        return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
      }

      return NextResponse.json(
        {
          error: `Pick a date between ${formatLongDate(minRow.date)} and ${formatLongDate(maxRow.date)}.`,
          field: 'date',
        },
        { status: 400 }
      )
    }

    const { data: existing, error: existingError } = await supabase
      .from('kpi_company_closure')
      .select('date')
      .eq('date', date)
      .maybeSingle()

    if (existingError) {
      console.error(existingError)
      return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
    }

    if (existing) {
      return NextResponse.json(
        { error: 'That date is already a closure.', field: 'date' },
        { status: 409 }
      )
    }

    if (dayRow.is_working_day === false) {
      return NextResponse.json(
        { error: 'That day is already a weekend or public holiday.', field: 'date' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('kpi_company_closure')
      .insert({ date, reason })
      .select()
      .single()

    if (error) {
      console.error(error)
      const mapped = mapDbError('closure', error)
      return errorResponse(mapped)
    }

    return NextResponse.json({ closure: data }, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}

export async function DELETE(request) {
  try {
    const gate = await requireAdmin()
    if (gate.denied) return gate.denied
    const { supabase } = gate

    const body = await readJsonBody(request)
    if (body === null) {
      return NextResponse.json({ error: SAVE_ERROR }, { status: 400 })
    }

    const result = validateClosure(body, 'delete')
    if (!result.ok) {
      return errorResponse(result)
    }

    const { data, error } = await supabase
      .from('kpi_company_closure')
      .delete()
      .eq('date', result.value.date)
      .select()

    if (error) {
      console.error(error)
      const mapped = mapDbError('closure', error)
      return errorResponse(mapped)
    }

    if (data.length === 0) {
      return NextResponse.json(
        { error: 'That closure has already been removed.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ removed: result.value.date }, { status: 200 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: SAVE_ERROR }, { status: 500 })
  }
}
