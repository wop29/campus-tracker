import { NextResponse } from 'next/server';
import { aiConfigured, requireUser } from '@/lib/ai';

/** Integration status for the Settings page. Booleans only; never returns keys or URLs. */
export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ supabase: true, anthropic: aiConfigured() });
}
