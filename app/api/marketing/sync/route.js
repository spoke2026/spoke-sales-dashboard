export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { requireUser, readJsonBody } from '@/lib/kpi/requireAdmin'
import { createAdminClient } from '@/lib/supabase/admin'
import { runMailchimpSync, runVercelSync, recentlySynced } from '@/lib/marketing/sync'
import { isMondayEightAmInAuckland } from '@/lib/marketing/mailchimp'

const SKIPPED = { ok: true, skipped: true }

// Pulls Mailchimp and Vercel Web Analytics side by side. With `auto`, a source
// tried in the last 15 minutes is skipped.
async function sync(trigger, { auto = false } = {}) {
  const admin = createAdminClient()
  if (!admin) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not set in Vercel yet.' },
      { status: 503 }
    )
  }

  const [skipMailchimp, skipVercel] = auto
    ? await Promise.all([recentlySynced(admin, 'mailchimp'), recentlySynced(admin, 'vercel')])
    : [false, false]

  const [mailchimp, vercel] = await Promise.all([
    skipMailchimp ? SKIPPED : runMailchimpSync({ admin, apiKey: process.env.MAILCHIMP_API_KEY, trigger }),
    skipVercel ? SKIPPED : runVercelSync({
      admin,
      token: process.env.VERCEL_ANALYTICS_TOKEN,
      projectId: process.env.VERCEL_ANALYTICS_PROJECT_ID || undefined,
      teamId: process.env.VERCEL_ANALYTICS_TEAM_ID || undefined,
      trigger,
    }),
  ])

  return NextResponse.json({ mailchimp, vercel })
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

// The tab's Refresh button, and its automatic refresh ({ auto: true }). Any
// signed-in user may pull fresh numbers; it only writes Mailchimp's and
// Vercel's own figures, never replies or enquiries. Both are logged as
// 'button': an on-demand refresh from the tab.
export async function POST(request) {
  const gate = await requireUser()
  if (gate.denied) return gate.denied
  const body = await readJsonBody(request)
  return sync('button', { auto: body?.auto === true })
}
