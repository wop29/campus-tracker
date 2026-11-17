'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { AiLabel, Button, Card, ConfirmButton, Field, Input, Select, Textarea } from '@/components/ui';
import { DECISION_LABEL, DECISION_STATUSES, LETTER_TITLE, buildLetterPrompt, stageBlock, stageForDecision, type DecisionStatus } from '@/lib/applications';
import { countWords } from '@/lib/logic/text';
import { STAGE_LABEL } from '@/lib/constants';
import { fmtDate } from '@/lib/utils';
import { patchDecision, syncDeadline, useAction, type TabProps } from './data';

export function DecisionTab({ b, reload }: TabProps) {
  const { app, decision } = b;
  const [d, setD] = useState({ decision: (decision?.decision ?? 'awaiting') as DecisionStatus, date: decision?.decision_date ?? '', notes: decision?.notes ?? '' });
  const { busy, run } = useAction();
  const sb = supabaseBrowser();
  const target = stageForDecision(d.decision, app.stage);
  const block = target && target !== app.stage ? stageBlock(target, { confirmed: !!app.submission_confirmed_at }) : null;

  async function save() {
    if (block) return;
    const ok = await run(async () => {
      if (target && target !== app.stage) await must(sb.from('applications').update({ stage: target }).eq('id', app.id));
      await patchDecision(app.id, { decision: d.decision, decision_date: d.date || null, notes: d.notes.trim() || null });
    }, 'Decision saved');
    if (ok) reload();
  }
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Decision</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Decision"><Select value={d.decision} onChange={(e) => setD({ ...d, decision: e.target.value as DecisionStatus })}>{DECISION_STATUSES.map((s) => <option key={s} value={s}>{DECISION_LABEL[s]}</option>)}</Select></Field>
          <Field label={d.decision === 'waitlisted' ? 'Waitlist notification date' : 'Decision date'}><Input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        </div>
        {target && target !== app.stage && !block && <p className="text-xs text-secondary">Saving also moves the application stage to {STAGE_LABEL[target]}.</p>}
        {block && <p className="text-xs text-danger" role="alert">{block}</p>}
        <div className="flex flex-wrap items-center gap-3"><Button onClick={() => void save()} disabled={busy || !!block}>{busy ? 'Saving...' : 'Save decision'}</Button>
          {d.decision === 'admitted' && <Link href="/applications?view=decisions" className="text-sm text-accent underline">Compare offers</Link>}</div>
        <p className="text-xs text-secondary">Scholarship amount and the deposit deadline are recorded on the Post-submission tab.</p>
      </Card>
      {decision?.decision === 'waitlisted' && <Waitlist b={b} reload={reload} />}
    </div>
  );
}

function Waitlist({ b, reload }: { b: TabProps['b']; reload: () => void }) {
  const { app, decision } = b;
  const school = app.school?.name ?? 'the school';
  const sb = supabaseBrowser();
  const { busy, run } = useAction();
  const [w, setW] = useState({ deadline: decision?.waitlist_response_deadline ?? '', contact: decision?.waitlist_contact ?? '', materials: decision?.waitlist_materials ?? '', notes: decision?.waitlist_notes ?? '' });
  const [ach, setAch] = useState({ title: '', description: '' });
  const [fu, setFu] = useState({ title: '', date: '' });
  const [interest, setInterest] = useState('');
  const [letter, setLetter] = useState(b.letter?.draft ?? '');
  const [aiUsed, setAiUsed] = useState(false);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const followUps = b.tasks.filter((t) => t.source === 'waitlist_followup');

  async function saveDetails() {
    if (await run(async () => {
      await patchDecision(app.id, { waitlist_response_deadline: w.deadline || null, waitlist_contact: w.contact.trim() || null, waitlist_materials: w.materials.trim() || null, waitlist_notes: w.notes.trim() || null });
      await syncDeadline(app.id, 'other', 'Waitlist response deadline', w.deadline);
    }, 'Waitlist details saved')) reload();
  }
  async function addAch() {
    if (!ach.title.trim()) { setAiMsg('Enter a title for the achievement.'); return; }
    setAiMsg(null);
    if (await run(async () => { await must(sb.from('achievements').insert({ title: ach.title.trim().slice(0, 200), description: ach.description.trim() || null, source_type: 'waitlist_update', source_id: app.id })); }, 'Achievement added')) { setAch({ title: '', description: '' }); reload(); }
  }
  async function delAch(id: string) { if (await run(async () => { await must(sb.from('achievements').delete().eq('id', id)); }, 'Achievement removed')) reload(); }
  async function addFu() {
    if (!fu.title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(fu.date)) { setAiMsg('Enter a follow-up title and date.'); return; }
    setAiMsg(null);
    if (await run(async () => { await must(sb.from('application_tasks').insert({ application_id: app.id, title: fu.title.trim(), due_date: fu.date, source: 'waitlist_followup' })); }, 'Follow-up added')) { setFu({ title: '', date: '' }); reload(); }
  }
  async function delFu(id: string) { if (await run(async () => { await must(sb.from('application_tasks').delete().eq('id', id)); }, 'Follow-up removed')) reload(); }
  async function saveLetter() {
    if (!letter.trim()) { setAiMsg('Write or generate a draft first.'); return; }
    setAiMsg(null);
    if (await run(async () => {
      if (b.letter) await must(sb.from('essays').update({ draft: letter, change_notes: aiUsed ? 'Edited after AI draft' : 'Edited by applicant' }).eq('id', b.letter.id));
      else await must(sb.from('essays').insert({ application_id: app.id, school_id: app.school_id, title: LETTER_TITLE, prompt: 'Letter of continued interest for the waitlist', draft: letter, status: 'first_draft' }));
    }, 'Letter saved as a new version')) reload();
  }
  async function draftWithAi() {
    const list = b.achievements.map((a) => (a.description ? `${a.title}: ${a.description}` : a.title));
    if (!list.length && !interest.trim()) { setAiMsg('Add at least one achievement or write why you remain interested. The draft uses only what you enter here.'); return; }
    setAiBusy(true); setAiMsg(null);
    try {
      const { system, prompt } = buildLetterPrompt({ school, program: app.program, achievements: list, interest, materials: w.materials });
      const res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system, prompt, maxTokens: 1200 }) });
      const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string; message?: string };
      if (res.status === 503) setAiMsg('AI is not configured on this server (ANTHROPIC_API_KEY is missing). You can still write the letter yourself.');
      else if (!res.ok || !json.text) setAiMsg(json.message ?? 'The AI request failed. Try again, or write the letter yourself.');
      else { setLetter(json.text); setAiUsed(true); }
    } catch { setAiMsg('Could not reach the AI service. Check your connection.'); }
    finally { setAiBusy(false); }
  }
  const words = countWords(letter);

  return (
    <Card className="space-y-5">
      <div><h2 className="text-sm font-semibold">Waitlist workspace</h2><p className="text-xs text-secondary">Notification date is the decision date above. Response deadline also appears in Deadlines.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Response deadline"><Input type="date" value={w.deadline} onChange={(e) => setW({ ...w, deadline: e.target.value })} /></Field>
        <Field label="Admissions contact"><Input value={w.contact} onChange={(e) => setW({ ...w, contact: e.target.value })} placeholder="Name and email" /></Field>
        <Field label="Updated materials you are sending" className="sm:col-span-2"><Textarea value={w.materials} onChange={(e) => setW({ ...w, materials: e.target.value })} placeholder="For example updated resume, new test score" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea value={w.notes} onChange={(e) => setW({ ...w, notes: e.target.value })} /></Field>
        <div className="sm:col-span-2"><Button onClick={() => void saveDetails()} disabled={busy}>Save waitlist details</Button>{decision?.waitlist_response_deadline && <span className="ml-3 text-xs text-secondary">Saved deadline: {fmtDate(decision.waitlist_response_deadline)}</span>}</div>
      </div>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Additional achievements since applying</h3>
        {b.achievements.length ? <ul className="space-y-1 text-sm">{b.achievements.map((a) => <li key={a.id} className="flex items-start justify-between gap-2 rounded-md bg-bg px-2 py-1.5"><span>{a.title}{a.description && <span className="block text-xs text-secondary">{a.description}</span>}</span><ConfirmButton size="sm" variant="ghost" aria-label={`Remove ${a.title}`} message="Remove this achievement? It is also removed from your profile achievements." onConfirm={() => void delAch(a.id)}><Trash2 size={14} /></ConfirmButton></li>)}</ul> : <p className="text-xs text-secondary">None yet.</p>}
        <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]"><Input aria-label="Achievement title" placeholder="Achievement" value={ach.title} onChange={(e) => setAch({ ...ach, title: e.target.value })} /><Input aria-label="Achievement detail" placeholder="Detail or measurable result (your facts only)" value={ach.description} onChange={(e) => setAch({ ...ach, description: e.target.value })} /><Button variant="secondary" onClick={() => void addAch()} disabled={busy}><Plus size={14} /> Add</Button></div>
        <p className="text-xs text-secondary">Saved to your profile achievements, marked as a waitlist update.</p>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Additional recommendations</h3>
        {b.recs.length ? <ul className="text-sm">{b.recs.map((r) => <li key={r.id}>{r.recommender?.name ?? 'Recommender'}: {r.status.replace(/_/g, ' ')}</li>)}</ul> : <p className="text-xs text-secondary">No recommendations tracked for this application.</p>}
        <Link href="/recommendations" className="text-xs text-accent underline">Manage recommendations</Link>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Follow-up dates</h3>
        {followUps.length ? <ul className="space-y-1 text-sm">{followUps.map((t) => <li key={t.id} className="flex items-center justify-between rounded-md bg-bg px-2 py-1.5"><span>{t.title} <span className="text-xs text-secondary">due {fmtDate(t.due_date)}{t.status === 'done' ? ' (done)' : ''}</span></span><ConfirmButton size="sm" variant="ghost" aria-label={`Remove ${t.title}`} message="Remove this follow-up?" onConfirm={() => void delFu(t.id)}><Trash2 size={14} /></ConfirmButton></li>)}</ul> : <p className="text-xs text-secondary">None yet.</p>}
        <div className="grid gap-2 sm:grid-cols-[1.5fr_1fr_auto]"><Input aria-label="Follow-up title" placeholder="For example Send update email" value={fu.title} onChange={(e) => setFu({ ...fu, title: e.target.value })} /><Input aria-label="Follow-up date" type="date" value={fu.date} onChange={(e) => setFu({ ...fu, date: e.target.value })} /><Button variant="secondary" onClick={() => void addFu()} disabled={busy}><Plus size={14} /> Add</Button></div>
        <p className="text-xs text-secondary">Follow-ups are tasks, so they also appear in the Tasks tab and Tasks view.</p>
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Letter of continued interest</h3>
        <Field label="Why you remain interested (in your own words)" hint="Optional. Used only to draft with AI, not saved."><Textarea value={interest} onChange={(e) => setInterest(e.target.value)} /></Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void draftWithAi()} disabled={aiBusy}>{aiBusy ? 'Drafting...' : 'Draft with AI'}</Button>
          <span className="text-xs text-secondary">Sends only the achievements, interest text and materials you entered above. It cannot add facts.</span>
        </div>
        {aiMsg && <p className="text-xs text-danger" role="alert">{aiMsg}</p>}
        {aiUsed && <div className="flex items-center gap-2 text-xs"><AiLabel /><span className="text-secondary">You are the author. Review every claim, fill the bracketed placeholders, and edit before saving.</span></div>}
        <Textarea aria-label="Letter draft" className="min-h-[220px]" value={letter} onChange={(e) => setLetter(e.target.value)} />
        <div className="flex items-center gap-3"><Button onClick={() => void saveLetter()} disabled={busy}>Save letter</Button><span className="text-xs text-secondary">{words} words{b.letter ? ` · current version ${b.letter.latest_version ?? 1}` : ''}. Each save creates a new version in Essays.</span></div>
      </section>
    </Card>
  );
}
