// Whether reminder emails can go out at all (an email provider is connected on the server).
// Booleans only: never returns keys, addresses or provider details. Signed-in users only (proxy.ts sends others a 401).
import 'server-only';
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { emailProvider } from '@/lib/email/send';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ email: emailProvider() !== 'none' }, { headers: { 'Cache-Control': 'no-store' } });
}
