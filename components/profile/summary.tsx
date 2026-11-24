'use client';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, AiLabel, ProgressBar } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/utils';
import { profileCompleteness, sectionLabels, sectionWeights, STATUS_CREDIT, type SectionKey, type SectionStatus } from '@/lib/profile';
import { aiEnabled, AI_OFF_MESSAGE } from '@/lib/features';
import { assess, DISCLAIMER, type Dimension } from '@/lib/competitiveness';
import { currentUserId, type ProfileData } from './data';

const STATUS_TONE: Record<SectionStatus, 'neutral' | 'warning' | 'accent' | 'success'> = { missing: 'neutral', incomplete: 'warning', needs_verification: 'accent', complete: 'success' };
const STATUS_LABEL: Record<SectionStatus, string> = { missing: 'Missing', incomplete: 'Incomplete', needs_verification: 'Needs verification', complete: 'Complete' };

export function CompletenessPanel({ data, onOpen }: { data: ProfileData; onOpen: (k: SectionKey) => void }) {
  const res = useMemo(() => profileCompleteness({ ...data, verification: data.profile?.field_verification, track: data.track, program: data.program }), [data]);
  const weights = sectionWeights(data.track); const labels = sectionLabels(data.track, data.program);
  return (
    <Card className="space-y-4">
      <div><div className="flex items-baseline justify-between"><h2 className="font-semibold">Profile details filled in</h2><span className="text-2xl font-semibold">{res.percent}%</span></div>
        <ProgressBar value={res.percent} tone={res.percent >= 80 ? 'success' : res.percent >= 40 ? 'warning' : 'danger'} />
        <p className="mt-1 text-xs text-secondary">This counts the details on this page only. Your Journey steps are tracked separately on the Journey page.</p>
        <details className="mt-1 text-xs text-secondary"><summary className="cursor-pointer">How this is counted</summary><p className="mt-1">Each section has a weight. Complete earns {STATUS_CREDIT.complete * 100}% of it, needs checking {STATUS_CREDIT.needs_verification * 100}%, started {STATUS_CREDIT.incomplete * 100}%, empty 0%. Weights: {(Object.entries(weights) as [SectionKey, number][]).filter(([, w]) => w > 0).map(([k, w]) => `${labels[k]} ${w}`).join(', ')}.</p></details></div>
      <ul className="divide-y">
        {res.sections.map((s) => (
          <li key={s.key} className="py-2.5">
            <div className="flex flex-wrap items-center gap-2"><button className="font-medium underline-offset-2 hover:underline" onClick={() => onOpen(s.key)}>{s.label}</button><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge><span className="text-xs text-secondary">{s.items} item{s.items === 1 ? '' : 's'}</span></div>
            {s.status !== 'complete' && s.missing.length > 0 && <p className="mt-1 text-sm text-secondary"><b className="font-medium text-primary">Missing:</b> {s.missing.join('; ')}</p>}
            {s.flagged.length > 0 && <p className="mt-1 text-sm text-secondary"><b className="font-medium text-primary">To verify:</b> {s.flagged.join('; ')}</p>}
          </li>))}
      </ul>
    </Card>
  );
}

const Dots = ({ n }: { n: number }) => <span className="font-mono tracking-widest" aria-label={`${n} out of 5`}>{'●'.repeat(n)}<span className="text-border">{'●'.repeat(5 - n)}</span></span>;
const List = ({ title, items }: { title: string; items: string[] }) => (items.length ? <div><h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">{title}</h4><ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null);

function DimCard({ d }: { d: Dimension }) {
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{d.label}</h3>{d.optional && d.score != null && <Badge>Optional</Badge>}
        {d.score == null ? <Badge>{d.optional ? 'Optional' : 'Not enough info yet'}</Badge> : <div className="flex items-center gap-2"><Dots n={d.score} /><span className="text-sm font-medium">{d.score} / 5</span><Badge tone={d.confidence === 'high' ? 'success' : d.confidence === 'medium' ? 'warning' : 'danger'}>{d.confidence} confidence</Badge></div>}
      </div>
      {d.insufficientReason && <p className="text-sm text-secondary">{d.insufficientReason}</p>}
      <details className="text-sm"><summary className="cursor-pointer text-secondary">How this is calculated</summary><p className="mt-1 text-secondary">{d.rule}</p></details>
      <List title="Evidence from your records" items={d.evidence} />
      {d.score != null && <List title="School expectations (sourced data only)" items={d.expectations} />}
      <List title="Weaknesses" items={d.weaknesses} />
      <List title="Improvement opportunities" items={d.improvements} />
    </Card>
  );
}

export function CompetitivenessPanel({ data, reload }: { data: ProfileData; reload: () => Promise<void> }) {
  const toast = useToast();
  const dims = useMemo(() => assess({ ...data }), [data]);
  const showAi = aiEnabled(); const who = data.track === 'undergrad' ? 'undergraduate' : data.program === 'mba' || !data.program ? 'MBA' : 'graduate';
  const [saving, setSaving] = useState(false); const [aiBusy, setAiBusy] = useState(false); const [ai, setAi] = useState<string | null>(null); const [aiErr, setAiErr] = useState<string | null>(null);
  const scored = dims.filter((d) => d.score != null).length; const counted = dims.filter((d) => !d.optional).length; const scoredCounted = dims.filter((d) => !d.optional && d.score != null).length;
  const payloadDims = dims.map((d) => ({ key: d.key, label: d.label, score: d.score, confidence: d.confidence, rule: d.rule, evidence: d.evidence, weaknesses: d.weaknesses, improvements: d.improvements, insufficientReason: d.insufficientReason ?? null }));

  async function save() {
    if (saving) return; setSaving(true);
    try {
      const sb = supabaseBrowser();
      await must(sb.from('ai_assessments').insert({ user_id: await currentUserId(sb), kind: 'profile', model: 'rules', result: { dimensions: payloadDims, disclaimer: DISCLAIMER, ...(ai ? { narrative: ai, narrative_is_ai: true } : {}) },
        input_snapshot: { generated_at: new Date().toISOString(), counts: { education: data.education.length, tests: data.tests.length, work: data.work.length, leadership: data.leadership.length, achievements: data.achievements.length, schoolDataRows: data.schoolData.length } } }).select('id'));
      toast('Snapshot saved'); await reload();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }
  async function narrative() {
    if (aiBusy) return; setAiBusy(true); setAiErr(null);
    try {
      const res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        system: `You summarise a rules-based ${who} applicant self-assessment. Use only the structured data provided. Do not invent facts, numbers or school requirements. Do not predict admission chances. State clearly where data is insufficient. Be concise, plain and direct, with short bullet points.`,
        prompt: `Write a short narrative of strengths, gaps and next steps based on this assessment data.\n\n${JSON.stringify({ dimensions: payloadDims, sourcedSchoolDataRows: data.schoolData.length }, null, 1)}`, maxTokens: 1200 }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 503) setAiErr(AI_OFF_MESSAGE);
      else if (!res.ok) setAiErr('We could not write the summary right now. Please try again later.');
      else setAi(j.text);
    } catch (e) { setAiErr('We could not write the summary right now. Please try again later.'); } finally { setAiBusy(false); }
  }
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm" role="note"><b>Self-assessment only.</b> {DISCLAIMER}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{scoredCounted} of {counted} areas have enough info</Badge>
        <div className="ml-auto flex gap-2">{showAi && <Button variant="secondary" size="sm" onClick={narrative} disabled={aiBusy || scored === 0}>{aiBusy ? 'Writing...' : 'Get AI summary'}</Button>}<Button size="sm" onClick={save} disabled={saving || scored === 0}>{saving ? 'Saving...' : 'Save snapshot'}</Button></div>
      </div>
      {showAi && aiErr && <div className="rounded-md border p-3 text-sm text-secondary" role="status">{aiErr}</div>}
      {showAi && ai && <Card className="space-y-2"><div className="flex items-center gap-2"><AiLabel /><span className="text-xs text-secondary">Written from the rule results above. Check it against your records.</span></div><div className="whitespace-pre-wrap text-sm">{ai}</div></Card>}
      <div className="grid gap-3 lg:grid-cols-2">{dims.map((d) => <DimCard key={d.key} d={d} />)}</div>
      <Card className="space-y-2"><h3 className="font-semibold">Saved snapshots</h3>
        {data.snapshots.length === 0 ? <EmptyState title="No snapshots saved yet" hint="Save a snapshot to track how your profile changes over time." /> : (
          <ul className="space-y-2">{data.snapshots.map((s) => (<li key={s.id} className="rounded-md border bg-white p-2 text-sm"><div className="text-xs text-secondary">{fmtDateTime(s.created_at)}{s.model ? ` | ${s.model}` : ''}</div>
            <div>{(s.result.dimensions ?? []).map((d) => `${d.label}: ${d.score ?? 'n/a'}`).join(' | ')}</div></li>))}</ul>)}
      </Card>
    </div>
  );
}
