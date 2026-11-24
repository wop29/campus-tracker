'use client';
import { useMemo, useState } from 'react';
import { Play, Sparkles, Trash2 } from 'lucide-react';
import { AiLabel, Button, Card, ConfirmButton, EmptyState, ErrorBox, Field, Input, Loading, Select, Textarea } from '@/components/ui';
import { useQuery, must } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { CATEGORIES, validateUserQuestionInput } from '@/lib/interview';
import { postJson } from '@/components/coach/api';
import { OriginBadge, type Q, type School } from './shared';

export function QuestionBank({ schools, schoolId, setSchoolId, onPractice }: { schools: School[]; schoolId: string; setSchoolId: (s: string) => void; onPractice: (ids: string[]) => void }) {
  const toast = useToast();
  const bank = useQuery<Q[]>((sb) => sb.from('interview_questions').select('*').is('session_id', null).order('created_at', { ascending: false }));
  const [cat, setCat] = useState(''); const [origin, setOrigin] = useState('');
  const [form, setForm] = useState({ question: '', category: CATEGORIES[0] as string, verified: false, source: '', school: '' });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [genCat, setGenCat] = useState(''); const [genBusy, setGenBusy] = useState(false); const [genErr, setGenErr] = useState<string | null>(null);

  const list = useMemo(() => (bank.data ?? []).filter((q) => (!cat || q.category === cat) && (!origin || q.origin === origin) && (!schoolId || q.school_id === schoolId || q.school_id === null)), [bank.data, cat, origin, schoolId]);
  const grouped = useMemo(() => {
    const m = new Map<string, Q[]>(); list.forEach((q) => m.set(q.category, [...(m.get(q.category) ?? []), q])); return Array.from(m.entries());
  }, [list]);

  const add = async () => {
    if (saving) return;
    const origin = form.verified ? 'verified_historical' : 'user';
    const err = validateUserQuestionInput({ question: form.question, category: form.category, origin, sourceNote: form.source }); setFormErr(err); if (err) return;
    setSaving(true);
    try {
      await must(supabaseBrowser().from('interview_questions').insert({ question: form.question.trim(), category: form.category, origin, source_note: form.verified ? form.source.trim() : null, school_id: form.school || null }).select('id'));
      setForm({ ...form, question: '', source: '', verified: false }); toast('Question added'); await bank.reload();
    } catch (e) { setFormErr((e as Error).message); } finally { setSaving(false); }
  };
  const generate = async () => {
    if (genBusy) return;
    if (!schoolId) { setGenErr('Choose a school in the filter first. Questions are tailored to one school.'); return; }
    setGenBusy(true); setGenErr(null);
    const r = await postJson<{ questions: Q[] }>('/api/ai/interview', { action: 'generate_questions', schoolId, category: genCat || undefined });
    setGenBusy(false);
    if (!r.ok) { setGenErr(r.error); return; }
    toast(`${r.data.questions.length} practice questions added`); await bank.reload();
  };
  const del = async (id: string) => { try { await must(supabaseBrowser().from('interview_questions').delete().eq('id', id).select('id')); toast('Question deleted'); await bank.reload(); } catch (e) { toast((e as Error).message, 'err'); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-3">
        <Field label="School" className="w-52"><Select value={schoolId} onChange={(e) => setSchoolId(e.target.value)}><option value="">All schools</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Category" className="w-52"><Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Origin" className="w-52"><Select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="">All origins</option><option value="user">Your questions</option><option value="ai_generated">AI-generated practice</option><option value="verified_historical">Verified historical</option></Select></Field>
        <Button variant="secondary" disabled={!list.length} onClick={() => onPractice(list.map((q) => q.id))}><Play size={14} /> Practice these ({list.length})</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="space-y-3">
          <p className="font-medium">Add your own question</p>
          <Field label="Question" error={formErr}><Textarea value={form.question} maxLength={500} onChange={(e) => setForm({ ...form, question: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="School (optional)"><Select value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })}><option value="">Any</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} /><span>I verified this was really asked (for example by an alum or official source)</span></label>
          {form.verified && <Field label="Source note (required)" hint="Where did this come from, and when?"><Input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Alumni call, Oct 2026" /></Field>}
          <Button onClick={() => void add()} disabled={saving}>{saving ? 'Saving...' : 'Add question'}</Button>
        </Card>
        <Card className="space-y-3">
          <p className="flex items-center gap-2 font-medium">Generate practice questions <AiLabel /></p>
          <p className="text-sm text-secondary">AI questions are practice material tailored to your records and the school selected in the filter. They are not known to be asked by the school and are never marked verified.</p>
          <Field label="Category (optional)"><Select value={genCat} onChange={(e) => setGenCat(e.target.value)}><option value="">Mixed</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          {genErr && <ErrorBox message={genErr} />}
          <Button onClick={() => void generate()} disabled={genBusy}><Sparkles size={14} /> {genBusy ? 'Generating...' : 'Generate questions'}</Button>
        </Card>
      </div>

      {bank.loading ? <Loading /> : bank.error ? <ErrorBox message={bank.error} onRetry={bank.reload} /> : !grouped.length ? <EmptyState title="No questions match" hint="Add your own question or generate practice questions for a school." /> : (
        <div className="space-y-4">
          {grouped.map(([category, qs]) => (
            <section key={category}><h3 className="mb-1.5 text-sm font-semibold">{category} <span className="font-normal text-secondary">({qs.length})</span></h3>
              <ul className="space-y-1.5">
                {qs.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-start gap-2 rounded-md border bg-white p-2.5 text-sm">
                    <div className="min-w-0 flex-1"><p>{q.question}</p><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-secondary"><OriginBadge q={q} />{q.school_id && <span>{schools.find((s) => s.id === q.school_id)?.name}</span>}{q.source_note && <span>Source: {q.source_note}</span>}</div></div>
                    <Button size="sm" variant="secondary" onClick={() => onPractice([q.id])}><Play size={12} /> Practice</Button>
                    <ConfirmButton size="sm" variant="ghost" message="Delete this question?" onConfirm={() => void del(q.id)} aria-label="Delete question"><Trash2 size={12} /></ConfirmButton>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
