'use client';
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { AiLabel, Button, ErrorBox, Field, Loading, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useQuery } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { REC_AI_KINDS, REC_STATUS_LABEL, buildRecAiRequest, type RecAiKind, type RecommendationRow, type RecommenderRow } from '@/lib/recommendations';
import { appLabel, errMsg, type AppLite } from '@/components/essays/data';
import { AI_OFF_MESSAGE, aiEnabled } from '@/lib/features';

type Exp = { id: string; company: string; position: string; description: string | null; achievements: string | null; measurable_impact: string | null };
type Ach = { id: string; title: string; description: string | null; quantified_impact: string | null };
type Story = { id: string; title: string; situation: string | null; action: string | null; result: string | null; quantified_impact: string | null };

type Props = { rec: RecommendationRow; recommender: RecommenderRow; app: AppLite | undefined; onClose: () => void };

/** AI drafting help for one recommendation. When AI is switched off (lib/features.ts) it only shows a short, friendly note. */
export function RecAiModal(props: Props) {
  if (!aiEnabled()) return (
    <Modal open onClose={props.onClose} title="Drafting help">
      <p className="text-sm text-secondary">{AI_OFF_MESSAGE}</p>
      <Button className="mt-3" onClick={props.onClose}>Close</Button>
    </Modal>
  );
  return <RecAiModalInner {...props} />;
}

function RecAiModalInner({ rec, recommender, app, onClose }: Props) {
  const toast = useToast();
  const exps = useQuery<Exp[]>((sb) => sb.from('work_experiences').select('id,company,position,description,achievements,measurable_impact').is('deleted_at', null).order('start_date', { ascending: false }), []);
  const achs = useQuery<Ach[]>((sb) => sb.from('achievements').select('id,title,description,quantified_impact').is('deleted_at', null).order('achieved_on', { ascending: false }), []);
  const stories = useQuery<Story[]>((sb) => sb.from('story_bank').select('id,title,situation,action,result,quantified_impact').is('deleted_at', null).order('title'), []);
  const prof = useQuery<{ full_name: string | null; preferred_name: string | null } | null>((sb) => sb.from('applicant_profiles').select('full_name,preferred_name').maybeSingle(), []);
  const [kind, setKind] = useState<RecAiKind>('briefing');
  const [pick, setPick] = useState<{ e: Set<string>; a: Set<string>; s: Set<string> }>({ e: new Set(), a: new Set(), s: new Set() });
  const [extra, setExtra] = useState('');
  const [out, setOut] = useState(''); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const toggle = (k: 'e' | 'a' | 's', id: string) => setPick((p) => { const n = new Set(p[k]); if (n.has(id)) n.delete(id); else n.add(id); return { ...p, [k]: n }; });

  async function generate() {
    if (busy) return; setNotice(null);
    if (!app) { setNotice('The application for this recommendation could not be loaded.'); return; }
    const { system, prompt, maxTokens } = buildRecAiRequest({
      kind, applicantName: prof.data?.preferred_name || prof.data?.full_name || undefined,
      recommender: { name: recommender.name, position: recommender.position, company: recommender.company, relationship: recommender.relationship, background: recommender.background },
      application: { school: app.schools?.name ?? 'the school', program: app.program, intake: app.intake, round: app.round },
      recommendation: { status: REC_STATUS_LABEL[rec.status], deadline: rec.deadline ? fmtDate(rec.deadline) : null, lastContact: rec.last_contact_at ? fmtDate(rec.last_contact_at) : null },
      experiences: (exps.data ?? []).filter((x) => pick.e.has(x.id)), achievements: (achs.data ?? []).filter((x) => pick.a.has(x.id)), stories: (stories.data ?? []).filter((x) => pick.s.has(x.id)), extraNotes: extra,
    });
    setBusy(true);
    try {
      const res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, prompt, maxTokens }) });
      const body = await res.json().catch(() => null);
      if (res.status === 503 || body?.error === 'not_configured') { setNotice(AI_OFF_MESSAGE); return; }
      if (res.status === 401) { setNotice('You are signed out. Sign in again and retry.'); return; }
      if (!res.ok || typeof body?.text !== 'string') { setNotice(body?.message ?? `The draft failed (status ${res.status}). Try again.`); return; }
      setOut(body.text);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(out); toast('Copied to clipboard'); } catch { toast('Could not copy. Select the text and copy it manually.', 'err'); } }

  const list = <T extends { id: string }>(label: string, k: 'e' | 'a' | 's', items: T[] | null, render: (x: T) => string, empty: string) => (
    <fieldset><legend className="mb-1 text-xs font-medium text-secondary">{label}</legend>
      {!items?.length ? <p className="text-xs text-secondary">{empty}</p> : <div className="max-h-28 space-y-0.5 overflow-auto rounded-md border p-2 text-sm">{items.map((x) => <label key={x.id} className="flex items-start gap-1.5"><input className="mt-1" type="checkbox" checked={pick[k].has(x.id)} onChange={() => toggle(k, x.id)} />{render(x)}</label>)}</div>}
    </fieldset>);
  return (
    <Modal open onClose={onClose} title={`AI assistance: ${recommender.name}${app ? `, ${appLabel(app)}` : ''}`} wide>
      <div className="space-y-3">
        <p className="rounded-md bg-bg p-2 text-xs text-secondary">Drafts use only the records you tick below and the application details. AI will not write the recommendation or say what {recommender.name} thinks. You remain the author.</p>
        {exps.loading || achs.loading || stories.loading ? <Loading /> : (exps.error || achs.error || stories.error) ? <ErrorBox message={(exps.error || achs.error || stories.error)!} /> : (<>
          <Field label="What do you want?"><Select value={kind} onChange={(e) => setKind(e.target.value as RecAiKind)}>{REC_AI_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}</Select></Field>
          {kind !== 'reminder' && kind !== 'school_guidance' && <div className="grid gap-3 md:grid-cols-3">
            {list('Work experience', 'e', exps.data, (x) => `${x.position}, ${x.company}`, 'None saved in Your story yet.')}
            {list('Achievements', 'a', achs.data, (x) => x.title, 'None saved in Your story yet.')}
            {list('Stories', 's', stories.data, (x) => x.title, 'Story bank is empty.')}</div>}
          <Field label="Anything else to include (optional)" hint="Facts only; this is sent with the draft request."><Textarea rows={2} value={extra} onChange={(e) => setExtra(e.target.value)} /></Field>
          <Button onClick={() => void generate()} disabled={busy}>{busy ? 'Drafting...' : 'Generate draft'}</Button>
        </>)}
        {notice && <p className="rounded-md bg-warning/10 p-2 text-sm" role="status">{notice}</p>}
        {out && <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between"><AiLabel /><Button size="sm" variant="secondary" onClick={() => void copy()}><Copy size={12} /> Copy</Button></div>
          <Textarea aria-label="Draft output (editable)" rows={12} value={out} onChange={(e) => setOut(e.target.value)} />
          <p className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs font-medium">Draft only: nothing is sent. You must review and send it yourself.</p>
        </div>}
      </div>
    </Modal>
  );
}
