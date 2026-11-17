'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Field, Input, ProgressBar } from '@/components/ui';
import { readiness, DEFAULT_WEIGHTS } from '@/lib/logic/readiness';
import { REQ_CATEGORIES, validateWeights } from '@/lib/applications';
import { titleCase } from '@/lib/utils';
import { saveWeights, useAction, type TabProps } from './data';

export function ReadinessTab({ b, weights, reload, reloadWeights, customWeights }: TabProps & { reloadWeights: () => void; customWeights: boolean }) {
  const r = readiness(b.reqs, weights);
  const [w, setW] = useState<Record<string, string>>({});
  const { busy, run } = useAction();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setW(Object.fromEntries(REQ_CATEGORIES.map((c) => [c, String(weights[c])]))); }, [weights]);
  async function save() {
    const nums = Object.fromEntries(REQ_CATEGORIES.map((c) => [c, w[c] === '' ? NaN : Number(w[c])]));
    const e = validateWeights(nums); setErr(e); if (e) return;
    if (await run(() => saveWeights(nums as typeof DEFAULT_WEIGHTS), 'Readiness weights saved')) { reloadWeights(); reload(); }
  }
  async function reset() { if (await run(() => saveWeights(null), 'Weights reset to defaults')) { reloadWeights(); reload(); } }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-4">
        <div><p className="text-xs text-secondary">Readiness</p><p className="text-3xl font-semibold tabular-nums">{r.percent}%</p></div>
        {REQ_CATEGORIES.map((c) => { const x = r.byCategory[c]; return (
          <div key={c}><div className="mb-1 flex justify-between text-xs"><span>{titleCase(c)} <span className="text-secondary">(weight {weights[c]})</span></span><span className="tabular-nums">{x ? `${x.done}/${x.total}` : 'no requirements'}</span></div><ProgressBar value={x ? (x.done / x.total) * 100 : 0} tone={x && x.done === x.total ? 'success' : 'accent'} /></div>); })}
        <p className="text-xs text-secondary">Each category scores the share of its requirements that are complete or waived. Categories with no requirements are left out and the other weights are rescaled.</p>
      </Card>
      <div className="space-y-4">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Blockers ({r.blockers.length})</h2>
          {r.blockers.length ? <ul className="space-y-1 text-sm">{r.blockers.map((x) => <li key={x.name} className="flex justify-between"><span>{x.name}</span><span className="text-xs text-secondary">{titleCase(x.category)}</span></li>)}</ul> : <p className="text-sm text-success">No mandatory requirements are open.</p>}
          <p className="mt-2 text-xs text-secondary">Mandatory requirements that are not complete or waived. Ready needs all of them except Submission confirmation.</p>
        </Card>
        <Card>
          <h2 className="mb-1 text-sm font-semibold">Weights</h2>
          <p className="mb-3 text-xs text-secondary">{customWeights ? 'Using your saved weights.' : 'Using the default weights.'} They apply to every application and are stored in your profile settings.</p>
          <form className="grid grid-cols-2 gap-2" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {REQ_CATEGORIES.map((c) => <Field key={c} label={titleCase(c)}><Input type="number" min={0} max={1000} value={w[c] ?? ''} onChange={(e) => setW({ ...w, [c]: e.target.value })} /></Field>)}
            {err && <p className="col-span-2 text-xs text-danger" role="alert">{err}</p>}
            <div className="col-span-2 flex gap-2"><Button type="submit" disabled={busy}>Save weights</Button><Button type="button" variant="secondary" disabled={busy || !customWeights} onClick={() => void reset()}>Reset to defaults</Button></div>
          </form>
        </Card>
      </div>
    </div>
  );
}
