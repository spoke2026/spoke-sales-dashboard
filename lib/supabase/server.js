import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server Supabase client bound to the request cookies (anon key).
 *
 * Requests made with this client run AS the logged-in user, so RLS is
 * exercised: authenticated users can SELECT targets, and only the admin
 * (public.is_admin()) can write them. Used by /api/dashboard (session read)
 * and /api/targets (session admin check + write).
 *
 * Mirrors the Tools Hub server client cookie getAll/setAll pattern, including
 * the try/catch on setAll for calls made from a Server Component context.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — safe to ignore because the
            // middleware refreshes the session.
          }
        },
      },
    }
  )
}
