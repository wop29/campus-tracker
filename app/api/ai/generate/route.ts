import { NextResponse } from 'next/server';
import { z } from 'zod';
import { aiConfigured, callClaude, requireUser } from '@/lib/ai';

const Body = z.object({ system: z.string().max(8000), prompt: z.string().min(1).max(60000), maxTokens: z.number().int().min(100).max(4000).optional() });
/** Generic authenticated text generation. The caller supplies real applicant data in the prompt. */
export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!aiConfigured()) return NextResponse.json({ error: 'not_configured', message: 'AI feedback is coming soon.' }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_request', details: parsed.error.flatten() }, { status: 400 });
  try {
    const out = await callClaude({ system: parsed.data.system, messages: [{ role: 'user', content: parsed.data.prompt }], maxTokens: parsed.data.maxTokens });
    return NextResponse.json({ text: out.text, model: out.model });
  } catch (e) { return NextResponse.json({ error: 'ai_error', message: (e as Error).message }, { status: 502 }); }
}
