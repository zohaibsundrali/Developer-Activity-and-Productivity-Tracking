import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if accessing protected developer routes
  if (pathname.startsWith('/developer')) {
    const developerUser = request.cookies.get('developer_auth')
    
    if (!developerUser) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // Check if accessing protected admin routes
  if (pathname.startsWith('/admin')) {
    const adminUser = request.cookies.get('admin_auth')

    if (!adminUser) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // Check if accessing protected client-portal routes
  if (pathname.startsWith('/client')) {
    const clientUser = request.cookies.get('client_auth')

    if (!clientUser) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/developer/:path*',
    '/admin/:path*',
    '/client/:path*'
  ]
}