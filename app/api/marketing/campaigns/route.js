export const dynamic = 'force-dynamic'

import { adminRequest, invalid, writeResult } from '@/lib/marketing/routes'
import { validateCampaignManual } from '@/lib/marketing/validate'

// Replies and enquiries only. The column grants in 0007 stop anything else on
// a campaign being changed from a signed-in session.
export async function PATCH(request) {
  const req = await adminRequest(request, { needsId: true })
  if (req.denied) return req.denied
  const result = validateCampaignManual(req.body)
  if (result.error) return invalid(result)
  return writeResult(
    await req.supabase
      .from('mkt_email_campaign')
      .update(result.value)
      .eq('id', req.body.id)
      .select('id')
  )
}
