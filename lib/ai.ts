import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { supabaseServer } from '@/lib/supabase/server';

export const aiConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);
export const MODEL = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

/** Returns the signed-in user or null. Every API route must call this first. */
export async function requireUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return { sb, user: data.user };
}
export const NO_FABRICATION = `Rules you must follow: Use ONLY facts present in the provided applicant data. Never invent achievements, numbers, employers, recommender opinions or school statistics. If information is missing, say what is missing. Label estimates as estimates. The applicant is the final author of everything.`;

export async function callClaude(opts: { system: string; messages: { role: 'user' | 'assistant'; content: string }[]; maxTokens?: number }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await client.messages.create({ model: MODEL(), max_tokens: opts.maxTokens ?? 2000, system: `${opts.system}\n\n${NO_FABRICATION}`, messages: opts.messages });
  return { text: res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n'), model: res.model };
}
/** Extracts the first JSON object from model output. Returns null if none parses. */
export function parseJson<T>(text: string): T | null {
  const m = text.match(/\{[\s\S]*\}/); if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}
