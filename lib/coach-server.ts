import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { aiConfigured, callClaude, parseJson, requireUser } from '@/lib/ai';

export const NOT_CONFIGURED = { error: 'not_configured', message: 'AI feedback is coming soon. Everything else in the app works as usual.' } as const;

/** Auth (401), body validation (400) and AI configuration (503), in that order. */
export async function guard<S extends z.ZodType>(req: Request, schema: S) {
  const { sb, user } = await requireUser();
  if (!user) return { res: NextResponse.json({ error: 'unauthorized', message: 'Sign in to use this feature.' }, { status: 401 }) } as const;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return { res: NextResponse.json({ error: 'invalid_request', message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, { status: 400 }) } as const;
  if (!aiConfigured()) return { res: NextResponse.json(NOT_CONFIGURED, { status: 503 }) } as const;
  return { sb, user, body: parsed.data as z.infer<S> } as const;
}
export const aiFailure = (e: unknown) => NextResponse.json({ error: 'ai_error', message: `The AI service returned an error: ${(e as Error).message}` }, { status: 502 });
export const badOutput = (detail?: string) => NextResponse.json({ error: 'bad_model_output', message: `The AI response was not in the expected format and was not saved.${detail ? ' (' + detail + ')' : ''} Please try again.` }, { status: 502 });
export const dbFailure = (e: unknown) => NextResponse.json({ error: 'db_error', message: (e as Error).message }, { status: 500 });
export const notFound = (what: string) => NextResponse.json({ error: 'not_found', message: `${what} not found.` }, { status: 404 });

/** Calls the model expecting a JSON object. Returns the parsed value or a ready-made error response. */
export async function callJson(system: string, user: string, maxTokens = 3000): Promise<{ raw: unknown; model: string } | { res: NextResponse }> {
  let out: { text: string; model: string };
  try { out = await callClaude({ system, messages: [{ role: 'user', content: user }], maxTokens }); } catch (e) { return { res: aiFailure(e) }; }
  const raw = parseJson<unknown>(out.text);
  if (raw === null) return { res: badOutput('not JSON') };
  return { raw, model: out.model };
}
