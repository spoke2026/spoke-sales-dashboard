export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/kpi/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMailchimpSync } from '@/lib/marketing/sync'
import { isMondayEightAmInAuckland } from '@/lib/marketing/mailchimp'

async function sync(trigger) {
  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel yet.' },
      { status: 503 }
    )
  }
  const result = await runMailchimpSync({
    admin,
    apiKey: process.env.MAILCHIMP_API_KEY,
    trigger,
  })
  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

// Vercel Cron. Vercel sends "Authorization: Bearer $CRON_SECRET" when the
// CRON_SECRET env var is set. Fails closed: no secret configured, no sync.
export async function GET(request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Not allowed' }, { status: 401 })
  }
  if (!isMondayEightAmInAuckland()) {
    return NextResponse.json({ ok: true, skipped: 'Not 8am Monday in Auckland' })
  }
  return sync('cron')
}

// "Refresh from Mailchimp" button. Any signed-in user may pull fresh numbers;
// it only writes Mailchimp's own figures, never anything typed in.
export async function POST() {
  const gate = await requireUser()
  if (gate.denied) return gate.denied
  return sync('button')
}
