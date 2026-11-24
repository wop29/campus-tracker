import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Refreshes the Supabase session and sends signed-out visitors to /login.
export async function proxy(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();           // not configured: the app shows a setup screen instead
  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => { list.forEach(({ name, value }) => req.cookies.set(name, value)); res = NextResponse.next({ request: req }); list.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    },
  });
  const { data: { user } } = await sb.auth.getUser();
  const open = req.nextUrl.pathname.startsWith('/login') || req.nextUrl.pathname.startsWith('/auth') || req.nextUrl.pathname === '/api/health'
    // These two check their own secret (cron bearer token, signed unsubscribe link), so they are reachable signed out.
    || req.nextUrl.pathname === '/api/cron/daily-reminders' || req.nextUrl.pathname === '/api/reminders/unsubscribe';
  if (!user && !open) {
    // API callers get a machine-readable 401, pages get a redirect
    if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (user && req.nextUrl.pathname === '/login') return NextResponse.redirect(new URL('/', req.url));
  return res;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)'] };
