'use client';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CornerDownRight, Flag, Play, Sparkles, Timer } from 'lucide-react';
import { AiLabel, Badge, Button, Card, ConfirmButton, ErrorBox, Field, Loading, Select, Textarea, Input } from '@/components/ui';
import { useQuery, must } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fmtDateTime } from '@/lib/utils';
import { CATEGORIES, SCORE_KEYS, SCORE_LABEL, fmtDuration, type ScoreKey } from '@/lib/interview';
import { postJson } from '@/components/coach/api';
import { OriginBadge, ScoreGrid, type FB, type Q, type School, type Sess } from './shared';
import { Recorder } from './recorder';

type Eval = { practice: string[]; claims: string[] };
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export function MockInterview({ schools, schoolId, setSchoolId, practiceIds, clearPractice, onChanged }: { schools: School[]; schoolId: string; setSchoolId: (s: string) => void; practiceIds: string[] | null; clearPractice: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [active, setActive] = useState<string | null>(null);
  const [cat, setCat] = useState(''); const [count, setCount] = useState(5);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const bank = useQuery<Q[]>((sb) => sb.from('interview_questions').select('*').is('session_id', null));
  const open = useQuery<Sess[]>((sb) => sb.from('interview_sessions').select('*').eq('kind', 'mock').eq('status', 'in_progress').order('started_at', { ascending: false }), [active]);

  const start = async () => {
    if (busy) return; setError(null);
    let pool = (bank.data ?? []);
    if (practiceIds?.length) pool = pool.filter((q) => practiceIds.includes(q.id));
    else pool = pool.filter((q) => (!cat || q.category === cat) && (!schoolId || q.school_id === schoolId || q.school_id === null));
    if (!pool.length) { setError('No questions to practice. Add or generate some in the Question bank first.'); return; }
    const chosen = practiceIds?.length ? pool : shuffle(pool).slice(0, count);
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const s = (await must(sb.from('interview_sessions').insert({ kind: 'mock', school_id: schoolId || null, status: 'in_progress', started_at: new Date().toISOString() }).select('id').single()))!;
      await must(sb.from('interview_questions').insert(chosen.map((q, i) => ({ session_id: s.id, school_id: q.school_id ?? (schoolId || null), category: q.category, question: q.question, origin: q.origin, source_note: q.source_note, asked_order: i + 1 }))).select('id'));
      clearPractice(); setActive(s.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (active) return <Run key={active} sessionId={active} schools={schools} onExit={() => { setActive(null); onChanged(); }} />;
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <p className="font-medium">Start a mock interview</p>
        <p className="text-sm text-secondary">You get one question at a time, a session timer, optional AI follow-ups and feedback on your typed answer. Everything is saved to your account.</p>
        {practiceIds?.length ? (
          <p className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="accent">{practiceIds.length} selected from the question bank</Badge><Button size="sm" variant="ghost" onClick={clearPractice}>Clear selection</Button></p>
        ) : (
          <div className="flex flex-wrap gap-3">
            <Field label="Category" className="w-52"><Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Mixed</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Number of questions" className="w-40"><Input type="number" min={1} max={12} value={count} onChange={(e) => setCount(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} /></Field>
          </div>
        )}
        <Field label="School" className="w-52"><Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}><option value="">No specific school</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        {error && <ErrorBox message={error} />}
        <Button onClick={() => void start()} disabled={busy || bank.loading}><Play size={14} /> {busy ? 'Starting...' : 'Start interview'}</Button>
      </Card>
      {!!open.data?.length && (
        <Card className="space-y-2"><p className="font-medium">Resume an unfinished session</p>
          {open.data.map((s) => <div key={s.id} className="flex items-center justify-between rounded border bg-white p-2 text-sm"><span>{schools.find((x) => x.id === s.school_id)?.name ?? 'No school'} | started {fmtDateTime(s.started_at)}</span><Button size="sm" variant="secondary" onClick={() => setActive(s.id)}>Resume</Button></div>)}
        </Card>
      )}
    </div>
  );
}

function Run({ sessionId, schools, onExit }: { sessionId: string; schools: School[]; onExit: () => void }) {
  const toast = useToast();
  const sess = useQuery<Sess | null>((sb) => sb.from('interview_sessions').select('*').eq('id', sessionId).maybeSingle(), [sessionId]);
  const qs = useQuery<Q[]>((sb) => sb.from('interview_questions').select('*').eq('session_id', sessionId).order('asked_order', { ascending: true }), [sessionId]);
  const qIds = (qs.data ?? []).map((q) => q.id);
  const fbs = useQuery<FB[]>((sb) => (qIds.length ? sb.from('interview_feedback').select('*').in('question_id', qIds).order('created_at', { ascending: true }) : Promise.resolve({ data: [], error: null })), [qIds.join(',')]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evals, setEvals] = useState<Record<string, Eval>>({});
  const [self, setSelf] = useState<Partial<Record<ScoreKey, number>>>({});
  const [now, setNow] = useState(() => Date.now());
  const [followNote, setFollowNote] = useState<string | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const questions = useMemo(() => qs.data ?? [], [qs.data]);
  const q = questions[Math.min(idx, Math.max(0, questions.length - 1))];
  useEffect(() => { setAnswers((a) => { const n = { ...a }; questions.forEach((x) => { if (n[x.id] === undefined) n[x.id] = x.answer ?? ''; }); return n; }); }, [questions]);
  useEffect(() => { setSelf({}); setFollowNote(null); setError(null); }, [q?.id]);
  const elapsed = sess.data?.started_at ? Math.max(0, Math.floor((now - new Date(sess.data.started_at).getTime()) / 1000)) : 0;
  const qFb = (fbs.data ?? []).filter((f) => q && f.question_id === q.id);
  const aiFb = [...qFb].reverse().find((f) => f.source === 'ai'); const selfFb = [...qFb].reverse().find((f) => f.source === 'self');
  const answer = q ? answers[q.id] ?? '' : '';
  const finished = sess.data?.status === 'completed';

  const save = async () => { if (!q) return; await must(supabaseBrowser().from('interview_questions').update({ answer: answer.trim() || null }).eq('id', q.id).select('id')); };
  const run = async (name: string, fn: () => Promise<void>) => { if (busy) return; setBusy(name); setError(null); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(null); } };

  const evaluate = () => run('evaluate', async () => {
    if (!q) return; if (!answer.trim()) throw new Error('Type your answer first.');
    const r = await postJson<{ practiceQuestions: string[]; unsupportedClaims: string[] }>('/api/ai/interview', { action: 'evaluate', questionId: q.id, answer: answer.trim() });
    if (!r.ok) throw new Error(r.error);
    setEvals((e) => ({ ...e, [q.id]: { practice: r.data.practiceQuestions, claims: r.data.unsupportedClaims } })); await fbs.reload(); await qs.reload();
  });
  const followUp = () => run('follow', async () => {
    if (!q) return; if (!answer.trim()) throw new Error('Type your answer first so the follow-up can respond to it.');
    const r = await postJson<{ question: Q; reason: string | null }>('/api/ai/interview', { action: 'follow_up', sessionId, questionId: q.id, answer: answer.trim() });
    if (!r.ok) throw new Error(r.error);
    // place the follow-up directly after the current question
    const order = questions.filter((x) => x.id !== r.data.question.id); order.splice(idx + 1, 0, r.data.question);
    const sb = supabaseBrowser();
    await Promise.all(order.map((x, i) => (x.asked_order === i + 1 && x.id !== r.data.question.id ? null : sb.from('interview_questions').update({ asked_order: i + 1 }).eq('id', x.id).select('id').then(({ error }) => { if (error) throw new Error(error.message); }))));
    await qs.reload(); setIdx(idx + 1); setFollowNote(r.data.reason);
  });
  const saveSelf = () => run('self', async () => {
    if (!q) return; const missing = SCORE_KEYS.filter((k) => !self[k]); if (missing.length) throw new Error('Score every dimension from 1 to 10.');
    await must(supabaseBrowser().from('interview_feedback').insert({ question_id: q.id, scores: self, source: 'self', feedback: null }).select('id')); toast('Self-score saved'); await fbs.reload();
  });
  const go = (d: number) => run('nav', async () => { await save(); setIdx((i) => Math.max(0, Math.min(questions.length - 1, i + d))); });
  const finish = () => run('finish', async () => {
    await save();
    const sb = supabaseBrowser(); const answered = Object.values(answers).some((a) => a.trim());
    await must(sb.from('interview_sessions').update({ status: answered ? 'completed' : 'cancelled', ended_at: new Date().toISOString(), duration_seconds: elapsed }).eq('id', sessionId).select('id'));
    toast(answered ? 'Session saved' : 'Session closed with no answers'); onExit();
  });
  const discard = async () => { try { await must(supabaseBrowser().from('interview_sessions').delete().eq('id', sessionId).select('id')); onExit(); } catch (e) { toast((e as Error).message, 'err'); } };

  if (sess.loading || qs.loading) return <Loading />;
  if (sess.error || qs.error) return <ErrorBox message={(sess.error || qs.error)!} onRetry={() => { void sess.reload(); void qs.reload(); }} />;
  if (!sess.data || !q) return <ErrorBox message="This session has no questions." />;
  const ev = evals[q.id];
  const notes = aiFb?.feedback;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-surface p-3">
        <div className="flex items-center gap-3 text-sm"><Badge tone="neutral">{schools.find((s) => s.id === sess.data!.school_id)?.name ?? 'No school'}</Badge><span className="flex items-center gap-1 font-mono" aria-label="Session timer"><Timer size={14} /> {fmtDuration(finished ? sess.data.duration_seconds ?? elapsed : elapsed)}</span><span className="text-secondary">Question {idx + 1} of {questions.length}</span></div>
        <div className="flex gap-2"><ConfirmButton size="sm" variant="ghost" message="Discard this whole session and its answers?" onConfirm={() => void discard()}>Discard</ConfirmButton><Button size="sm" onClick={() => void finish()} disabled={!!busy}><Flag size={12} /> Finish session</Button></div>
      </div>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><Badge tone="neutral">{q.category}</Badge><OriginBadge q={q} /></div>
        <p className="text-lg font-medium">{q.question}</p>
        {followNote && <p className="text-xs text-secondary">Why this follow-up: {followNote}</p>}
        <Textarea className="min-h-[160px]" value={answer} maxLength={6000} placeholder="Type your answer as you would say it..." onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} aria-label="Your answer" />
        <p className="text-xs text-secondary">{answer.trim() ? answer.trim().split(/\s+/).length : 0} words (about {Math.max(1, Math.round((answer.trim() ? answer.trim().split(/\s+/).length : 0) / 130))} min spoken)</p>
        <Recorder />
        {error && <ErrorBox message={error} />}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void go(-1)} disabled={!!busy || idx === 0}><ArrowLeft size={14} /> Previous</Button>
          <Button variant="secondary" onClick={() => run('save', async () => { await save(); toast('Answer saved'); })} disabled={!!busy}>Save answer</Button>
          <Button onClick={() => void evaluate()} disabled={!!busy || !answer.trim()}><Sparkles size={14} /> {busy === 'evaluate' ? 'Evaluating...' : 'Get AI feedback'}</Button>
          <Button variant="secondary" onClick={() => void followUp()} disabled={!!busy || !answer.trim()}><CornerDownRight size={14} /> {busy === 'follow' ? 'Thinking...' : 'Ask a follow-up'}</Button>
          <Button variant="secondary" onClick={() => void go(1)} disabled={!!busy || idx >= questions.length - 1}>Next <ArrowRight size={14} /></Button>
        </div>
      </Card>
      {aiFb && (
        <Card className="space-y-2"><div className="flex items-center gap-2"><p className="font-medium">AI feedback</p><AiLabel /></div>
          <ScoreGrid scores={aiFb.scores} />
          {notes && <div className="whitespace-pre-wrap text-sm">{notes}</div>}
          {!!ev?.practice.length && <div><p className="text-xs font-medium text-secondary">Recommended practice questions</p><ul className="ml-4 list-disc text-sm">{ev.practice.map((p, i) => <li key={i}>{p}</li>)}</ul></div>}
          <p className="text-xs text-secondary">The AI judges your typed text only (not voice or delivery). Scores are a rough guide, not an official evaluation.</p>
        </Card>
      )}
      <Card className="space-y-2">
        <p className="font-medium">Your own self-score {selfFb && <Badge tone="success">Saved</Badge>}</p>
        {selfFb ? <ScoreGrid scores={selfFb.scores} /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{SCORE_KEYS.map((k) => <Field key={k} label={SCORE_LABEL[k]}><Select value={self[k] ?? ''} onChange={(e) => setSelf({ ...self, [k]: Number(e.target.value) || undefined })}><option value="">-</option>{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</Select></Field>)}</div>
            <Button size="sm" variant="secondary" onClick={() => void saveSelf()} disabled={!!busy}>Save self-score</Button>
          </>
        )}
      </Card>
    </div>
  );
}
