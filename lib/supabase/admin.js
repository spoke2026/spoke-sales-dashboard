import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role Supabase client. Bypasses RLS, so it is used ONLY by the
 * Mailchimp sync (lib/marketing/sync.js), which must run from Vercel Cron with
 * no signed-in user. Never import this from a client component or use it for
 * anything a person types in; those writes go through lib/supabase/server.js
 * so RLS keeps them admin-only.
 *
 * Returns null when SUPABASE_SERVICE_ROLE_KEY is not set, so callers can fail
 * closed with a clear message instead of throwing.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
