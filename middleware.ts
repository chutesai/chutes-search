import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCanonicalSearchHostRedirect } from '@/lib/canonicalHost';

export function middleware(request: NextRequest) {
  const requestHost =
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    request.nextUrl.host;
  const canonicalHost = getCanonicalSearchHostRedirect(requestHost);
  if (!canonicalHost) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.host = canonicalHost;
  url.protocol = 'https:';
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|icon.png|icon-50.png|icon-100.png|manifest.webmanifest).*)',
  ],
};
