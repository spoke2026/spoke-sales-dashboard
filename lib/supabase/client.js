import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client (anon key), cookie-backed via @supabase/ssr.
 *
 * Used by the /login page and the dashboard client component for
 * signInWithPassword, signOut, and getUser. Auth cookies written here are the
 * same cookies the middleware and the server client read, so a browser login
 * flows through to server-side RLS enforcement.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
}
