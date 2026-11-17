'use client';
import { useState } from 'react';
import { ExternalLink, Sparkles } from 'lucide-react';
import { AiLabel, Badge, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { must } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { AI_SYSTEM, buildInvestigatePrompt, scholarshipApplicationSchema, todayIso, type ScholarshipRow } from '@/lib/scholarships';
import { fmtDate, titleCase } from '@/lib/utils';
import { appLabel, fieldErrors, money, type AppLite, type SchoolLite } from '@/components/finance/shared';
import { Flags } from './flags';

export type SchApp = { id: string; scholarship_id: string; application_id: string | null; status: string; applied_at: string | null; decision_at: string | null; awarded_amount: number | null; notes: string | null };

export function ScholarshipDetail({ s, schoolName, rec, apps, schools, onClose, onChanged }: { s: ScholarshipRow; schoolName: string; rec: SchApp | null; apps: AppLite[]; schools: SchoolLite[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast(); const today = todayIso();
  const [busyCheck, setBusyCheck] = useState(false);
  async function toggleChecked(v: boolean) {
    if (busyCheck) return; setBusyCheck(true);
    try { await must(supabaseBrowser().from('scholarships').update({ eligibility_checked: v, updated_at: new Date().toISOString() }).eq('id', s.id)); await onChanged(); toast(v ? 'Marked as confirmed by you' : 'Confirmation removed'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusyCheck(false); }
  }
  return (
    <Modal open onClose={onClose} title={s.name} wide>
      <div className="space-y-4 text-sm">
        <Flags s={s} today={today} />
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {([['Institution', s.institution], ['Linked school', schoolName], ['Category', s.category ? titleCase(s.category) : null], ['Status', titleCase(s.status)], ['Amount', s.amount == null ? null : money(s.amount, s.currency)], ['Deadline', s.deadline ? fmtDate(s.deadline) : null], ['Source verified on', s.source_verified_on ? fmtDate(s.source_verified_on) : null]] as [string, string | null][]).map(([k, v]) => <div key={k}><dt className="text-xs text-secondary">{k}</dt><dd>{v || <span className="text-secondary">Not provided</span>}</dd></div>)}
          <div><dt className="text-xs text-secondary">Website</dt><dd>{s.website_url ? <a className="inline-flex items-center gap-1 text-accent underline" href={s.website_url} target="_blank" rel="noopener noreferrer">Open source <ExternalLink size={12} /></a> : <span className="text-secondary">Not provided</span>}</dd></div>
        </dl>
        <div className="rounded-md border bg-bg p-3">
          <p className="text-xs font-medium text-secondary">Eligibility, exactly as you entered it</p>
          <p className="mt-1 whitespace-pre-wrap">{s.eligibility || <span className="text-secondary">Nothing entered. Check the official requirements.</span>}</p>
          <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={s.eligibility_checked} disabled={busyCheck} onChange={(e) => toggleChecked(e.target.checked)} /> <span className="font-medium">Eligibility confirmed by me</span></label>
          <p className="mt-1 text-xs text-secondary">This app never decides eligibility. Tick this only after you have checked the published requirements yourself.</p>
          {!s.eligibility_checked && ['eligible', 'preparing', 'applied'].includes(s.status) && <p className="mt-1"><Badge tone="warning">Status says {titleCase(s.status)} but you have not confirmed eligibility</Badge></p>}
        </div>
        {s.requirements && <div><p className="text-xs text-secondary">Application requirements</p><p className="whitespace-pre-wrap">{s.requirements}</p></div>}
        {s.notes && <div><p className="text-xs text-secondary">Notes</p><p className="whitespace-pre-wrap">{s.notes}</p></div>}
        <TrackingForm key={rec?.id ?? 'none'} s={s} rec={rec} apps={apps} schools={schools} onChanged={onChanged} />
        <AiHelper s={s} today={today} />
      </div>
    </Modal>
  );
}

function TrackingForm({ s, rec, apps, schools, onChanged }: { s: ScholarshipRow; rec: SchApp | null; apps: AppLite[]; schools: SchoolLite[]; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState({ application_id: rec?.application_id ?? '', status: rec?.status ?? 'preparing', applied_at: rec?.applied_at ?? '', decision_at: rec?.decision_at ?? '', awarded_amount: rec?.awarded_amount?.toString() ?? '', notes: rec?.notes ?? '' });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const schoolMap = new Map(schools.map((x) => [x.id, x]));
  const options = apps.filter((a) => !a.deleted_at && (!s.school_id || a.school_id === s.school_id));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const p = scholarshipApplicationSchema.safeParse(f); if (!p.success) { setErrs(fieldErrors(p.error)); return; }
    setErrs({}); setBusy(true);
    try {
      const sb = supabaseBrowser();
      if (rec) await must(sb.from('scholarship_applications').update(p.data).eq('id', rec.id)); else await must(sb.from('scholarship_applications').insert({ ...p.data, scholarship_id: s.id }));
      toast('Application tracking saved'); await onChanged();
    } catch (x) { toast((x as Error).message, 'err'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} noValidate className="rounded-md border p-3">
      <p className="mb-2 font-medium">Application tracking</p>
      {!rec && <p className="mb-2 text-xs text-secondary">A tracking record is created automatically when the status becomes Applied. You can also start one here.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Linked school application" error={errs.application_id}><Select value={f.application_id} onChange={set('application_id')}><option value="">None</option>{options.map((a) => <option key={a.id} value={a.id}>{appLabel(a, schoolMap)}</option>)}</Select></Field>
        <Field label="Tracking status" error={errs.status}><Input value={f.status} onChange={set('status')} /></Field>
        <Field label="Applied on" error={errs.applied_at}><Input type="date" value={f.applied_at} onChange={set('applied_at')} /></Field>
        <Field label="Decision on" error={errs.decision_at}><Input type="date" value={f.decision_at} onChange={set('decision_at')} /></Field>
        <Field label={`Awarded amount (${s.currency})`} error={errs.awarded_amount}><Input inputMode="decimal" value={f.awarded_amount} onChange={set('awarded_amount')} /></Field>
        <Field label="Tracking notes" error={errs.notes}><Textarea className="min-h-[40px]" value={f.notes} onChange={set('notes')} /></Field>
      </div>
      <Button type="submit" size="sm" className="mt-3" disabled={busy}>{busy ? 'Saving...' : rec ? 'Save tracking' : 'Start tracking'}</Button>
    </form>
  );
}

function AiHelper({ s, today }: { s: ScholarshipRow; today: string }) {
  const [text, setText] = useState<string | null>(null); const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function run() {
    if (busy) return; setBusy(true); setMsg(null); setText(null);
    try {
      const res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: AI_SYSTEM, prompt: buildInvestigatePrompt(s, today), maxTokens: 800 }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 503 && j.error === 'not_configured') setMsg('AI is not configured on this server, so this helper is unavailable. Everything else still works. Review the eligibility text and official source yourself.');
      else if (!res.ok) setMsg(j.message || j.error || 'The AI request failed. Try again.');
      else setText(j.text);
    } catch { setMsg('Could not reach the AI service. Check your connection and try again.'); } finally { setBusy(false); }
  }
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">Why might this be worth investigating?</p><Button size="sm" variant="secondary" onClick={run} disabled={busy}><Sparkles size={14} /> {busy ? 'Thinking...' : 'Ask AI'}</Button></div>
      <p className="mt-1 text-xs text-secondary">Sends only this saved record. The AI does not decide eligibility and cannot add scholarships.</p>
      {msg && <p className="mt-2 text-sm text-secondary" role="status">{msg}</p>}
      {text && <div className="mt-2 space-y-2"><AiLabel /><p className="whitespace-pre-wrap">{text}</p><p className="text-xs text-secondary">Check eligibility against the published requirements before relying on any of this.</p></div>}
    </div>
  );
}
