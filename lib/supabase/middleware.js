import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Builds the request-bound Supabase client, resolves the current user with a
 * SINGLE getUser() call, and returns both the response (carrying any refreshed
 * auth cookies) and the resolved user.
 *
 * This helper does NOT enforce auth and does NOT redirect. The allow/deny
 * decision lives entirely in middleware.js. `user` is null on an absent session
 * AND on any error thrown while resolving it — so the caller treats "no user /
 * errored user" as a single deny (fail closed).
 *
 * Callers must confirm the Supabase env vars are present before calling this;
 * middleware.js does so and returns 503 first if they are missing.
 */
export async function updateSession(request, response) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  let user = null
  try {
    // Refreshes and validates the session in one call.
    const {
      data: { user: resolvedUser },
    } = await supabase.auth.getUser()
    user = resolvedUser
  } catch (error) {
    // Fail closed: any session-resolution error (e.g. Auth API unreachable)
    // yields a null user, which the middleware turns into a deny.
    console.error('Session resolution error:', error)
    user = null
  }

  return { response, user }
}
