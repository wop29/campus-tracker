'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import { AiLabel, Badge, Button, ConfirmButton, EmptyState, ErrorBox, Field, Loading, Select, Textarea } from '@/components/ui';
import { useQuery, must } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { fmtDateTime } from '@/lib/utils';
import { supabaseBrowser } from '@/lib/supabase/client';
import { COACH_MODE_HINT, LIMITS, type CoachMode } from '@/lib/coach';
import { postJson } from './api';
import { UsedContext, type Used } from './used-context';

type Msg = { role: 'user' | 'assistant'; content: string; at?: string; usedContext?: Used[] };
type Convo = { id: string; mode: string; messages: Msg[]; updated_at: string };
const STARTERS: Record<CoachMode, string[]> = {
  strategist: ['Where is my profile weakest for this school?', 'Which three stories should I lead with?'],
  essay_coach: ['Help me brainstorm angles for this prompt.', 'What evidence is missing from my draft?'],
  interview_coach: ['Which of my stories fit a leadership question?', 'How should I structure my why-MBA answer?'],
  execution: ['What should I do this week?', 'Which deadlines are at risk?'],
};
const title = (c: Convo) => (c.messages.find((m) => m.role === 'user')?.content ?? 'Empty conversation').slice(0, 60);

export function CoachChat({ mode, initial }: { mode: CoachMode; initial?: { schoolId?: string; applicationId?: string; essayId?: string } }) {
  const toast = useToast();
  const [convoId, setConvoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [schoolId, setSchoolId] = useState(initial?.schoolId ?? '');
  const [applicationId, setApplicationId] = useState(initial?.applicationId ?? '');
  const [essayId, setEssayId] = useState(initial?.essayId ?? '');
  const endRef = useRef<HTMLDivElement>(null);
  const convos = useQuery<Convo[]>((sb) => sb.from('ai_conversations').select('id,mode,messages,updated_at').eq('mode', mode).order('updated_at', { ascending: false }).limit(30), [mode]);
  const schools = useQuery<{ id: string; name: string }[]>((sb) => sb.from('schools').select('id,name').is('deleted_at', null).order('name'));
  const apps = useQuery<{ id: string; school_id: string; intake: string; round: string | null }[]>((sb) => sb.from('applications').select('id,school_id,intake,round').is('deleted_at', null).order('created_at', { ascending: false }));
  const essays = useQuery<{ id: string; title: string }[]>((sb) => sb.from('essays').select('id,title').is('deleted_at', null).order('updated_at', { ascending: false }), []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages, busy]);

  const open = (c: Convo) => { setConvoId(c.id); setMessages(c.messages ?? []); setError(null); };
  const fresh = () => { setConvoId(null); setMessages([]); setError(null); };
  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (busy || !message) return;
    if (message.length > LIMITS.message) { setError(`Message is longer than ${LIMITS.message} characters.`); return; }
    setBusy(true); setError(null); setInput('');
    setMessages((m) => [...m, { role: 'user', content: message }]);
    const r = await postJson<{ reply: string; conversationId: string; usedContext: Used[] }>('/api/ai/coach', {
      mode, message, conversationId: convoId ?? undefined, schoolId: schoolId || undefined, applicationId: applicationId || undefined, essayId: essayId || undefined,
    });
    if (!r.ok) { setMessages((m) => m.slice(0, -1)); setInput(message); setError(r.error); setBusy(false); return; }
    setMessages((m) => [...m, { role: 'assistant', content: r.data.reply, usedContext: r.data.usedContext }]);
    setConvoId(r.data.conversationId); setBusy(false); void convos.reload();
  };
  const remove = async (id: string) => {
    try { await must(supabaseBrowser().from('ai_conversations').delete().eq('id', id).select('id')); if (id === convoId) fresh(); void convos.reload(); toast('Conversation deleted'); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-2">
        <Button className="w-full" variant="secondary" onClick={fresh} disabled={busy}><Plus size={14} /> New conversation</Button>
        {convos.loading ? <Loading /> : convos.error ? <ErrorBox message={convos.error} onRetry={convos.reload} /> : !convos.data?.length ? <p className="text-xs text-secondary">No saved conversations yet.</p> : (
          <ul className="space-y-1">
            {convos.data.map((c) => (
              <li key={c.id} className={`flex items-start gap-1 rounded-md border p-2 text-xs ${c.id === convoId ? 'border-accent bg-accent/5' : 'bg-white'}`}>
                <button className="min-w-0 flex-1 text-left" onClick={() => open(c)} disabled={busy}><span className="block truncate font-medium">{title(c)}</span><span className="text-secondary">{fmtDateTime(c.updated_at)}</span></button>
                <ConfirmButton size="sm" variant="ghost" message="Delete this conversation?" onConfirm={() => void remove(c.id)} aria-label="Delete conversation"><Trash2 size={12} /></ConfirmButton>
              </li>
            ))}
          </ul>
        )}
      </aside>
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-3">
          <p className="flex-1 basis-60 text-sm text-secondary">{COACH_MODE_HINT[mode]}</p>
          {mode !== 'essay_coach' && (
            <>
              <Field label="School (optional)" className="w-44"><Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}><option value="">None</option>{schools.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Application (optional)" className="w-48"><Select value={applicationId} onChange={(e) => setApplicationId(e.target.value)}><option value="">None</option>{apps.data?.map((a) => <option key={a.id} value={a.id}>{schools.data?.find((x) => x.id === a.school_id)?.name ?? 'School'} {a.intake}{a.round ? ` ${a.round}` : ''}</option>)}</Select></Field>
            </>
          )}
          {mode === 'essay_coach' && <Field label="Essay (recommended)" className="w-60"><Select value={essayId} onChange={(e) => setEssayId(e.target.value)}><option value="">No essay selected</option>{essays.data?.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</Select></Field>}
        </div>
        <div className="min-h-[320px] space-y-3 rounded-lg border bg-white p-4" aria-live="polite">
          {!messages.length && !busy && (
            <EmptyState title="Start a conversation" hint="The coach only uses records you have entered. Nothing is invented." action={<div className="flex flex-wrap justify-center gap-2">{STARTERS[mode].map((s) => <Button key={s} size="sm" variant="secondary" onClick={() => void send(s)} disabled={busy}>{s}</Button>)}</div>} />
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
              <div className={`max-w-[88%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-white' : 'border bg-surface'}`}>
                {m.role === 'assistant' && <div className="mb-1"><AiLabel /></div>}
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.role === 'assistant' && <UsedContext used={m.usedContext} />}
              </div>
            </div>
          ))}
          {busy && <p className="text-sm text-secondary" role="status">Thinking...</p>}
          <div ref={endRef} />
        </div>
        {error && <ErrorBox message={error} />}
        <div className="flex items-end gap-2">
          <Textarea className="flex-1" value={input} maxLength={LIMITS.message} placeholder="Ask the coach..." onChange={(e) => setInput(e.target.value)} disabled={busy}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} aria-label="Message" />
          <Button onClick={() => void send()} disabled={busy || !input.trim()}><Send size={14} /> Send</Button>
        </div>
        <p className="text-xs text-secondary">Ctrl or Cmd + Enter sends. Only your last {LIMITS.historyMessages} messages are sent to the model. <Badge tone="neutral">Qualitative guidance, not an official evaluation</Badge></p>
      </section>
    </div>
  );
}
