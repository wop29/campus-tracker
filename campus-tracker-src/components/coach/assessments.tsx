'use client';
import { useMemo, useState } from 'react';
import { AiLabel, Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, ProgressBar, Select } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/utils';
import { compareProfiles, ASSESSMENT_DISCLAIMER, type GapResultT, type ProfileResultT } from '@/lib/coach';
import { postJson } from './api';
import { UsedContext, type Used } from './used-context';

type Row = { id: string; kind: 'profile' | 'school_gap'; school_id: string | null; result: (ProfileResultT | GapResultT) & { assumptions?: string; school_data_status?: string }; model: string | null; input_snapshot: { used?: Used[] } | null; created_at: string };
const tierTone = (t: string) => (t === 'Stronger fit' ? 'success' : t === 'Competitive' ? 'accent' : t === 'Reach' ? 'warning' : 'neutral') as 'success';
const sevTone = (s: string) => (s === 'high' ? 'danger' : s === 'medium' ? 'warning' : 'neutral') as 'danger';
const List = ({ title, items }: { title: string; items: string[] }) => (items.length ? <div><p className="text-xs font-medium text-secondary">{title}</p><ul className="ml-4 list-disc text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div> : null);

function ProfileView({ r, prev }: { r: ProfileResultT; prev?: ProfileResultT }) {
  const cmp = useMemo(() => (prev ? compareProfiles(prev, r) : null), [prev, r]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={tierTone(r.tier)}>Tier: {r.tier}</Badge><span className="text-xs text-secondary">Qualitative tier, not a probability</span></div>
      <p className="text-sm">{r.overall}</p>
      {cmp && (
        <Card><p className="mb-2 text-sm font-medium">Change since the previous profile assessment</p>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-secondary"><th className="py-1">Dimension</th><th>Previous</th><th>Now</th><th>Change</th></tr></thead>
            <tbody>{cmp.map((c) => <tr key={c.name} className="border-t"><td className="py-1">{c.name}</td><td>{c.previous ?? 'n/a'}</td><td>{c.current ?? 'n/a'}</td><td>{c.trend === 'n/a' ? '-' : c.trend === 'same' ? 'No change' : `${c.delta! > 0 ? '+' : ''}${c.delta} (${c.trend})`}</td></tr>)}</tbody></table>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {r.dimensions.map((d) => (
          <Card key={d.name} className="space-y-2">
            <div className="flex items-center justify-between gap-2"><p className="font-medium">{d.name}</p><Badge tone="neutral">Confidence: {d.confidence}</Badge></div>
            {d.score === null ? <p className="text-sm text-secondary">Not enough data to score. Add more detail on your Profile.</p> : <div className="flex items-center gap-2"><div className="flex-1"><ProgressBar value={d.score * 20} tone={d.score >= 4 ? 'success' : d.score >= 3 ? 'accent' : 'warning'} /></div><span className="text-sm font-medium">{d.score}/5</span></div>}
            <List title="Evidence" items={d.evidence} /><List title="Gaps" items={d.gaps} /><List title="Improvements" items={d.improvements} />
          </Card>
        ))}
      </div>
    </div>
  );
}
function GapView({ r }: { r: GapResultT & { school_data_status?: string } }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={r.school_data_status === 'researched' ? 'success' : 'warning'}>{r.school_data_status === 'researched' ? 'Compared with sourced school data' : 'School data not researched'}</Badge></div>
      <p className="text-sm">{r.summary}</p>
      {!r.gaps.length && <p className="text-sm text-secondary">No gaps reported.</p>}
      {r.gaps.map((g, i) => (
        <Card key={i} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{g.title}</p><Badge tone={sevTone(g.severity)}>{g.severity} severity</Badge><Badge tone={g.fixable ? 'success' : 'neutral'}>{g.fixable ? 'Fixable' : 'Hard to change'}</Badge></div>
          <List title="Evidence" items={g.evidence} />
          <p className="text-sm"><span className="text-xs font-medium text-secondary">Potential impact: </span>{g.potential_impact}</p>
          <p className="text-sm"><span className="text-xs font-medium text-secondary">Recommended action: </span>{g.recommended_action}</p>
          <p className="text-xs text-secondary">Effort: {g.estimated_effort}. Timeline: {g.suggested_timeline}.</p>
        </Card>
      ))}
    </div>
  );
}

export function Assessments() {
  const [kind, setKind] = useState<'profile' | 'school_gap'>('profile');
  const [schoolId, setSchoolId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const schools = useQuery<{ id: string; name: string }[]>((sb) => sb.from('schools').select('id,name').is('deleted_at', null).order('name'));
  const hist = useQuery<Row[]>((sb) => sb.from('ai_assessments').select('id,kind,school_id,result,model,input_snapshot,created_at').in('kind', ['profile', 'school_gap']).order('created_at', { ascending: false }).limit(100));
  const schoolName = (id: string | null) => schools.data?.find((s) => s.id === id)?.name ?? 'Unknown school';
  const rows = useMemo(() => (hist.data ?? []).filter((r) => r.kind === kind && (kind === 'profile' || !schoolId || r.school_id === schoolId)), [hist.data, kind, schoolId]);
  const current = rows.find((r) => r.id === selected) ?? rows[0];
  const idx = current ? rows.findIndex((r) => r.id === current.id) : -1;
  const previous = idx >= 0 ? rows.slice(idx + 1).find((r) => kind === 'profile' || r.school_id === current?.school_id) : undefined;

  const run = async () => {
    if (busy) return;
    if (kind === 'school_gap' && !schoolId) { setError('Choose a school first.'); return; }
    setBusy(true); setError(null);
    const r = await postJson<{ assessmentId: string }>('/api/ai/assess', { kind, schoolId: kind === 'school_gap' ? schoolId : undefined });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setSelected(r.data.assessmentId); setCompare(false); await hist.reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-surface p-3">
        <Field label="Assessment type" className="w-56"><Select value={kind} onChange={(e) => { setKind(e.target.value as 'profile' | 'school_gap'); setSelected(null); setCompare(false); }}><option value="profile">Profile assessment</option><option value="school_gap">School gap analysis</option></Select></Field>
        {kind === 'school_gap' && <Field label="School" className="w-56"><Select value={schoolId} onChange={(e) => { setSchoolId(e.target.value); setSelected(null); }}><option value="">Choose a school</option>{schools.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
        <Button onClick={() => void run()} disabled={busy || (kind === 'school_gap' && !schoolId)}>{busy ? 'Analysing...' : kind === 'profile' ? 'Run profile assessment' : 'Run gap analysis'}</Button>
        <p className="basis-full text-xs text-secondary">{ASSESSMENT_DISCLAIMER} Scores are only given where your records support them. School comparisons use sourced school data only; if a school is not researched you will be told.</p>
      </div>
      {error && <ErrorBox message={error} />}
      {hist.loading ? <Loading /> : hist.error ? <ErrorBox message={hist.error} onRetry={hist.reload} /> : !rows.length ? <EmptyState title="No assessments yet" hint="Run one above. Each run is saved so you can compare progress over time." /> : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-1">
            <p className="text-xs font-medium text-secondary">History ({rows.length})</p>
            {rows.map((r) => (
              <button key={r.id} onClick={() => { setSelected(r.id); setCompare(false); }} className={`block w-full rounded-md border p-2 text-left text-xs ${r.id === current?.id ? 'border-accent bg-accent/5' : 'bg-white'}`}>
                <span className="block font-medium">{fmtDateTime(r.created_at)}</span>
                <span className="text-secondary">{r.kind === 'profile' ? `Tier: ${(r.result as ProfileResultT).tier}` : schoolName(r.school_id)}</span>
              </button>
            ))}
          </aside>
          {current && (
            <section className="space-y-3">
              <div className="flex flex-wrap items-center gap-2"><AiLabel /><span className="text-xs text-secondary">{fmtDateTime(current.created_at)}{current.kind === 'school_gap' ? ` | ${schoolName(current.school_id)}` : ''}</span>
                {kind === 'profile' && <Button size="sm" variant="secondary" disabled={!previous} onClick={() => setCompare((c) => !c)}>{compare ? 'Hide comparison' : 'Compare with previous'}</Button>}
                {kind === 'profile' && !previous && <span className="text-xs text-secondary">No earlier profile assessment to compare with.</span>}
              </div>
              {current.kind === 'profile' ? <ProfileView r={current.result as ProfileResultT} prev={compare && previous ? (previous.result as ProfileResultT) : undefined} /> : <GapView r={current.result as GapResultT} />}
              <p className="text-xs text-secondary">{(current.result as { disclaimer?: string }).disclaimer}</p>
              <UsedContext used={current.input_snapshot?.used} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
