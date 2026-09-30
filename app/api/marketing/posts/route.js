export const dynamic = 'force-dynamic'

import { adminRequest, invalid, writeResult } from '@/lib/marketing/routes'
import { validatePost } from '@/lib/marketing/validate'

export async function POST(request) {
  const req = await adminRequest(request)
  if (req.denied) return req.denied
  const result = validatePost(req.body)
  if (result.error) return invalid(result)
  return writeResult(await req.supabase.from('mkt_social_post').insert(result.value))
}

export async function PATCH(request) {
  const req = await adminRequest(request, { needsId: true })
  if (req.denied) return req.denied
  const result = validatePost(req.body)
  if (result.error) return invalid(result)
  return writeResult(
    await req.supabase.from('mkt_social_post').update(result.value).eq('id', req.body.id).select('id')
  )
}

export async function DELETE(request) {
  const req = await adminRequest(request, { needsId: true })
  if (req.denied) return req.denied
  return writeResult(
    await req.supabase.from('mkt_social_post').delete().eq('id', req.body.id).select('id')
  )
}
