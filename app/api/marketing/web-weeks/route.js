export const dynamic = 'force-dynamic'

import { adminRequest, invalid, writeResult } from '@/lib/marketing/routes'
import { validateWebWeek } from '@/lib/marketing/validate'

const DUPLICATE = {
  duplicateField: 'week_start',
  duplicateMessage: 'That week already has numbers. Edit that row instead.',
}

export async function POST(request) {
  const req = await adminRequest(request)
  if (req.denied) return req.denied
  const result = validateWebWeek(req.body)
  if (result.error) return invalid(result)
  return writeResult(
    await req.supabase.from('mkt_web_week').insert({ ...result.value, source: 'manual' }),
    DUPLICATE
  )
}

export async function PATCH(request) {
  const req = await adminRequest(request, { needsId: true })
  if (req.denied) return req.denied
  const result = validateWebWeek(req.body)
  if (result.error) return invalid(result)
  return writeResult(
    await req.supabase
      .from('mkt_web_week')
      .update({ ...result.value, source: 'manual' })
      .eq('id', req.body.id)
      .select('id'),
    DUPLICATE
  )
}

export async function DELETE(request) {
  const req = await adminRequest(request, { needsId: true })
  if (req.denied) return req.denied
  return writeResult(
    await req.supabase.from('mkt_web_week').delete().eq('id', req.body.id).select('id')
  )
}
