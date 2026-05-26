// middleware.js
// Protects the entire dashboard with a simple password
// Password is set via DASHBOARD_PASSWORD environment variable in Vercel

import { NextResponse } from 'next/server'

export function middleware(request) {
  // Skip API routes — they have their own auth via HubSpot key
  if (request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const basicAuth = request.headers.get('authorization')
  const url = request.nextUrl

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1]
    const [user, pwd] = atob(authValue).split(':')
    const validPassword = process.env.DASHBOARD_PASSWORD || 'spoke2026'

    if (pwd === validPassword) {
      return NextResponse.next()
    }
  }

  // Return 401 to trigger browser password prompt
  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Spoke Sales Dashboard"',
    },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|spoke-logo.png).*)'],
}
