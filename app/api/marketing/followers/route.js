export const dynamic = 'force-dynamic'

import { adminRequest, invalid, writeResult } from '@/lib/marketing/routes'
import { validateFollower } from '@/lib/marketing/validate'

// One count per platform, account and month: saving a month that already has
// a count replaces it.
export async function POST(request) {
  const req = await adminRequest(request)
  if (req.denied) return req.denied
  const result = validateFollower(req.body)
  if (result.error) return invalid(result)
  return writeResult(
    await req.supabase
      .from('mkt_follower_count')
      .upsert(result.value, { onConflict: 'platform,account,month' })
  )
}

export async function DELETE(request) {
  const req = await adminRequest(request, { needsId: true })
  if (req.denied) return req.denied
  return writeResult(
    await req.supabase.from('mkt_follower_count').delete().eq('id', req.body.id).select('id')
  )
}
