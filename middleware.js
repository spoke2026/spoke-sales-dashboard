import { NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * The perimeter. Every matched page route must carry a valid Supabase session,
 * except the sign-in screen at /login. /api requests pass through so the route
 * handlers can self-enforce and return JSON status codes (401/403) rather than
 * HTML redirects.
 *
 * Fails CLOSED on both failure modes:
 *   (a) Supabase env missing → 503 for ALL paths (including /login, so there is
 *       no redirect loop). The app never opens without its config.
 *   (b) Any error resolving the session, or an absent session → treated as no
 *       user and redirected to /login. Never NextResponse.next() on an error.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl

  // (1) Fail closed on missing env — before touching updateSession.
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return new NextResponse('Service unavailable', { status: 503 })
  }

  // (2) Single getUser(), carrying refreshed auth cookies on the response.
  const response = NextResponse.next({ request })
  const { response: sessionResponse, user } = await updateSession(request, response)

  // (3) The sign-in screen is always reachable (session-refreshed).
  if (pathname === '/login') {
    return sessionResponse
  }

  // (4) API routes pass through — handlers self-enforce 401/403 and return JSON.
  //     Never redirect an API call to HTML. Still refreshes the session cookie.
  if (pathname.startsWith('/api')) {
    return sessionResponse
  }

  // (5) No user (absent or errored session) → deny by redirecting to /login.
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // (6) Valid session → allow, keeping the refreshed cookies.
  return sessionResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|spoke-logo.png|.*\\.[\\w]+$).*)'],
}
