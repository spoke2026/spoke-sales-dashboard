import { NextResponse } from 'next/server'

export function middleware(request) {
  if (request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.next()
  }

  const basicAuth = request.headers.get('authorization')

  if (basicAuth) {
    const authValue = basicAuth.split(' ')[1]
    const [user, pwd] = atob(authValue).split(':')
    const validPassword = process.env.DASHBOARD_PASSWORD || 'spoke2026'
    const validUser = process.env.DASHBOARD_USERNAME || 'spoke'

    if (pwd === validPassword && (user === validUser || user === '')) {
      return NextResponse.next()
    }
  }

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