'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { Button, Card, Field, ProgressBar, RiskBadge, Select, Textarea } from '@/components/ui';
import { readiness } from '@/lib/logic/readiness';
import { timeRemaining } from '@/lib/logic/risk';
import { enrich, readyBlockers, stageBlock, type AppListRow } from '@/lib/applications';
import { STAGES, STAGE_LABEL, type Stage } from '@/lib/constants';
import { fmtDateTime } from '@/lib/utils';
import { changeStage, useAction, type TabProps } from './data';

export function OverviewTab({ b, reload, weights, goTab }: TabProps & { goTab: (t: string) => void }) {
  const { app } = b;
  const [target, setTarget] = useState<Stage>(app.stage);
  const [notes, setNotes] = useState(app.notes ?? '');
  const { busy, run } = useAction();
  const r = readiness(b.reqs, weights);
  const e = enrich({ ...app, deadlines: b.deadlines, application_requirements: b.reqs, decision: null } as unknown as AppListRow, weights);
  const blockers = readyBlockers(b.reqs);
  const block = target !== app.stage ? stageBlock(target, { confirmed: !!app.submission_confirmed_at }) : null;

  async function move() {
    if (target === app.stage || block) return;
    if (await run(() => changeStage(app.id, target), `Stage changed to ${STAGE_LABEL[target]}`)) reload();
  }
  async function saveNotes() {
    if (await run(async () => { await must(supabaseBrowser().from('applications').update({ notes: notes.trim() || null }).eq('id', app.id)); }, 'Notes saved')) reload();
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Readiness</h2>
        <div className="flex items-center gap-3"><div className="flex-1"><ProgressBar value={r.percent} tone={r.percent >= 80 ? 'success' : 'accent'} /></div><span className="text-lg font-semibold tabular-nums">{r.percent}%</span></div>
        <p className="text-xs text-secondary">{b.reqs.filter((x) => x.status === 'complete' || x.status === 'waived').length} of {b.reqs.length} requirements complete or waived. {blockers.length} mandatory item(s) block Ready. <button className="underline" onClick={() => goTab('readiness')}>See breakdown</button></p>
        <h2 className="pt-2 text-sm font-semibold">Deadline risk</h2>
        {e.nearest ? (
          <div className="text-sm">
            <p>{e.nearest.name}: {fmtDateTime(e.nearest.due_at)} ({e.nearest.timezone})</p>
            <p className="text-secondary">{timeRemaining(e.nearest.due_at)}</p>
            {e.risk && <p className="mt-1 flex items-center gap-2"><RiskBadge risk={e.risk.risk} /><span className="text-xs text-secondary">{e.risk.reason}. Assumes half a day per open mandatory item.</span></p>}
          </div>
        ) : <p className="text-sm text-secondary">No deadline yet. <button className="underline" onClick={() => goTab('deadlines')}>Add one</button> to see risk.</p>}
      </Card>
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Stage</h2>
        <Field label="Move to stage">
          <Select value={target} onChange={(ev) => setTarget(ev.target.value as Stage)} aria-label="Stage">
            {STAGES.filter((s) => s !== 'submitted' || s === app.stage).map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}{s === app.stage ? ' (current)' : ''}</option>)}
          </Select>
        </Field>
        {block && <p className="text-xs text-danger" role="alert">{block} {target === 'submitted' && <button className="underline" onClick={() => goTab('submission')}>Open Final review</button>}</p>}
        {target === 'ready' && app.stage !== 'ready' && (
          blockers.length ? (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs" role="status">
              <p className="font-medium">Cannot mark Ready yet: {blockers.length} mandatory requirement(s) incomplete.</p>
              <ul className="mt-1 list-disc pl-4">{blockers.map((x) => <li key={x.name}>{x.name}</li>)}</ul>
              <button className="mt-1 underline" onClick={() => goTab('requirements')}>Open requirements</button>
            </div>
          ) : <p className="text-xs text-success">All mandatory requirements are complete.</p>
        )}
        <Button onClick={() => void move()} disabled={busy || target === app.stage || !!block}>{busy ? 'Updating...' : 'Update stage'}</Button>
        <p className="text-xs text-secondary">Submitting is done from the Final review tab. The database refuses Ready while mandatory items are open.</p>
      </Card>
      <Card className="space-y-2 lg:col-span-2">
        <Field label="Notes"><Textarea value={notes} onChange={(ev) => setNotes(ev.target.value)} /></Field>
        <Button variant="secondary" onClick={() => void saveNotes()} disabled={busy || notes === (app.notes ?? '')}>Save notes</Button>
      </Card>
    </div>
  );
}
