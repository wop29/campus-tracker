import { NextResponse } from 'next/server';
import { callClaude } from '@/lib/ai';
import { loadContext } from '@/lib/ai-context';
import { CoachBody, LIMITS, buildCoachMessages, coachSystemPrompt, hasUnlabelledProbability, type ChatMsg } from '@/lib/coach';
import { aiFailure, dbFailure, guard, notFound } from '@/lib/coach-server';

const CAUTION = '\n\n_Note: any percentage above is not an official admission probability. Treat it as a speculative estimate at best._';

export async function POST(req: Request) {
  const g = await guard(req, CoachBody); if ('res' in g) return g.res;
  const { sb, body } = g;
  try {
    let history: (ChatMsg & { at?: string })[] = []; let convoId = body.conversationId ?? null;
    if (convoId) {
      const { data, error } = await sb.from('ai_conversations').select('id,mode,messages').eq('id', convoId).maybeSingle();
      if (error) throw error; if (!data) return notFound('Conversation');
      if (data.mode !== body.mode) return NextResponse.json({ error: 'invalid_request', message: 'This conversation belongs to a different coach mode.' }, { status: 400 });
      history = Array.isArray(data.messages) ? data.messages : [];
      if (history.length >= LIMITS.storedMessages) return NextResponse.json({ error: 'invalid_request', message: 'This conversation is full. Start a new one.' }, { status: 400 });
    }
    const ctx = await loadContext(sb, { mode: body.mode, schoolId: body.schoolId, applicationId: body.applicationId, essayId: body.essayId, query: body.message });
    const messages = buildCoachMessages(history, body.message);
    let reply: string;
    try { reply = (await callClaude({ system: coachSystemPrompt(body.mode, ctx.text), messages, maxTokens: 1800 })).text.trim(); } catch (e) { return aiFailure(e); }
    if (!reply) return NextResponse.json({ error: 'bad_model_output', message: 'The AI returned an empty reply. Please try again.' }, { status: 502 });
    if (hasUnlabelledProbability(reply)) reply += CAUTION;
    const now = new Date().toISOString();
    const next = [...history, { role: 'user', content: body.message, at: now }, { role: 'assistant', content: reply, at: now, usedContext: ctx.used }];
    if (convoId) {
      const { error } = await sb.from('ai_conversations').update({ messages: next }).eq('id', convoId); if (error) throw error;
    } else {
      const { data, error } = await sb.from('ai_conversations').insert({ mode: body.mode, messages: next }).select('id').single(); if (error) throw error; convoId = data.id;
    }
    return NextResponse.json({ reply, conversationId: convoId, usedContext: ctx.used });
  } catch (e) { return dbFailure(e); }
}
