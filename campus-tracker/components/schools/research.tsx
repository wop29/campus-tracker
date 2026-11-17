'use client';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { AiLabel, Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Textarea } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { FIELD_BY_KEY, buildResearchContext, dataFlags, flagWords, formatValue, type DataRow } from '@/lib/schools';
import type { GoalsRow } from '@/lib/profile';
import { SchoolsNav, SourceLink } from './shared';

type Row = DataRow & { schools: { name: string } };
const Q = z.string().trim().min(5, 'Ask a specific question (at least 5 characters)').max(1500, 'Keep the question under 1500 characters');
const SYSTEM = `You are a research assistant for an MBA applicant. You may use ONLY the sourced school data rows and the applicant goals given in the prompt. Rules: (1) If the data needed to answer is missing, say exactly what is missing and do not guess or use outside knowledge about schools. (2) Never present data flagged "possibly outdated", "unverified" or with an unknown publication year as current or confirmed; state the publication year and flag. (3) Cite the school, field and source name for every figure. (4) Do not predict admission chances. (5) Be concise and plain.`;

export function ResearchView() {
  const rows = useQuery<Row[]>((sb) => sb.from('school_admissions_data').select('*, schools!inner(name, deleted_at)').is('schools.deleted_at', null).order('school_id'), []);
  const goals = useQuery<GoalsRow | null>((sb) => sb.from('career_goals').select('*').maybeSingle(), []);
  const [q, setQ] = useState(''); const [qErr, setQErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [used, setUsed] = useState<(DataRow & { school_name: string })[]>([]); const [truncated, setTruncated] = useState(false);

  const all = useMemo(() => (rows.data ?? []).map((r) => ({ ...r, school_name: r.schools.name })), [rows.data]);
  const g = goals.data;
  const goalText = g ? [['Target industry', g.target_industry], ['Target function', g.target_function], ['Target geography', g.target_geography], ['Short-term goal', g.short_term_goal], ['Long-term goal', g.long_term_goal], ['Target companies', g.target_companies?.join(', ')]].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n') : '';

  async function ask() {
    if (busy) return; const p = Q.safeParse(q); if (!p.success) { setQErr(p.error.issues[0].message); return; } setQErr(null);
    const ctx = buildResearchContext(all); if (!ctx.used.length) { setQErr('No sourced data rows to use. Add data points on a school page first.'); return; }
    setBusy(true); setAnswer(null); setNotice(null);
    try {
      const prompt = `Today's date: ${new Date().toISOString().slice(0, 10)}\n\nApplicant goals (user-entered):\n${goalText || 'Not provided'}\n\nSourced school data rows (the only school facts you may use):\n${ctx.text}\n\nQuestion: ${p.data}`;
      const res = await fetch('/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system: SYSTEM, prompt, maxTokens: 1500 }) });
      const j = await res.json().catch(() => ({}));
      if (res.status === 503) setNotice(j.message ?? 'AI is not configured. Set ANTHROPIC_API_KEY to enable the research assistant. The rest of the app works without it.');
      else if (!res.ok) setNotice(j.message ?? j.error ?? 'The AI request failed. Try again.');
      else { setAnswer(j.text); setUsed(ctx.used); setTruncated(ctx.truncated); }
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="School Portfolio" subtitle="Ask questions about your researched schools." />
      <SchoolsNav active="research" />
      {rows.loading && !rows.data ? <Loading /> : rows.error ? <ErrorBox message={rows.error} onRetry={() => void rows.reload()} /> : all.length === 0 ? <EmptyState title="No researched data yet" hint="The assistant only reads data points you saved with a source. Add some on a school page." /> : (
        <div className="space-y-4">
          <Card className="space-y-3">
            <p className="text-sm text-secondary">The assistant receives only your {all.length} sourced data point{all.length === 1 ? '' : 's'}{goalText ? ' and your career goals' : ''}. It has been told to say when data is missing and never to present outdated data as current. Verify anything important at the source.</p>
            <form onSubmit={(e) => { e.preventDefault(); void ask(); }} className="space-y-2">
              <Field label="Your question" error={qErr}><Textarea value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which of my schools has the lowest tuition, and how old is that data?" maxLength={1500} /></Field>
              <Button type="submit" disabled={busy}>{busy ? 'Thinking...' : 'Ask'}</Button>
            </form>
          </Card>
          {notice && <div className="rounded-md border p-3 text-sm text-secondary" role="status">{notice}</div>}
          {answer && (
            <Card className="space-y-3"><div className="flex items-center gap-2"><AiLabel /><span className="text-xs text-secondary">Based only on the rows listed below.</span></div>
              <div className="whitespace-pre-wrap text-sm">{answer}</div>
              {truncated && <p className="text-xs text-warning">Some rows were left out because the data was too large to send. Narrow your question to a few schools.</p>}
              <details open><summary className="cursor-pointer text-sm font-medium">Data rows sent to the assistant ({used.length})</summary>
                <div className="mt-2 overflow-x-auto"><table className="w-full text-xs"><thead className="text-left text-secondary"><tr><th className="p-1">School</th><th className="p-1">Field</th><th className="p-1">Value</th><th className="p-1">Source</th><th className="p-1">Year</th><th className="p-1">Flags</th></tr></thead>
                  <tbody className="divide-y">{used.map((r) => { const def = FIELD_BY_KEY[r.field]; const f = flagWords(dataFlags(r)); return (<tr key={r.id}><td className="p-1">{r.school_name}</td><td className="p-1">{def?.label ?? r.field}</td><td className="max-w-xs truncate p-1" title={formatValue(def, r)}>{formatValue(def, r)}</td><td className="p-1"><SourceLink name={r.source_name} url={r.source_url} /></td><td className="p-1">{r.publication_year ?? 'unknown'}</td><td className="p-1">{f.length ? f.map((x) => <Badge key={x} tone={x.includes('outdated') ? 'danger' : 'warning'} className="mr-1">{x}</Badge>) : '-'}</td></tr>); })}</tbody></table></div>
              </details>
            </Card>)}
        </div>)}
    </div>
  );
}
