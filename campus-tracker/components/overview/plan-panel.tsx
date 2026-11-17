'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { saveSettingsPatch, workingHoursSchema } from '@/lib/settings';
import { buildDayPlan, buildWeeklyReview } from '@/lib/planning';
import { fmtDate } from '@/lib/utils';
import { formatInZone, type DeadlineRowView } from '@/lib/overview-logic';
import type { OverviewData, StoredRecommendation } from '@/lib/overview-data';

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim() : `${m}m`);

export function DailyPlan({ data, recs, hours, now, onSaved }: { data: OverviewData; recs: StoredRecommendation[]; hours: number | null; now: Date; onSaved: () => void }) {
  const toast = useToast();
  const [value, setValue] = useState(hours != null ? String(hours) : '');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    const p = workingHoursSchema.safeParse(value);
    if (!p.success) { setErr(p.error.issues[0].message); return; }
    setErr(null); setSaving(true);
    try { await saveSettingsPatch(supabaseBrowser(), { working_hours_per_day: p.data }); toast('Working hours saved'); onSaved(); } catch (e) { toast((e as Error).message, 'err'); }
    setSaving(false);
  };
  const plan = hours != null ? buildDayPlan({ hours, tasks: data.tasks, recs, now }) : null;
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Hours available per day" error={err} className="w-44"><Input type="number" inputMode="decimal" step="0.5" min="0.5" max="16" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Button onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save hours'}</Button>
      </div>
      {!plan ? <p className="mt-3 text-sm text-secondary">Set the hours you can work each day to get a plan.</p> : (
        <div className="mt-4 space-y-3">
          <p className="text-sm" role="status">Planned {mins(plan.usedMin)} of {mins(plan.capacityMin)} available.</p>
          {plan.planned.length === 0 && plan.didNotFit.length === 0 && <EmptyState title="Nothing to plan" hint="You have no open tasks or recommended actions." />}
          {plan.planned.length > 0 && <PlanList title="Plan for today" items={plan.planned} />}
          {plan.didNotFit.length > 0 && <PlanList title="Did not fit today" items={plan.didNotFit} muted />}
          <p className="text-xs text-secondary">Items without an estimate are counted as 30 minutes and marked "assumed". Task priority 1 is treated as highest.</p>
        </div>
      )}
    </Card>
  );
}
function PlanList({ title, items, muted }: { title: string; items: ReturnType<typeof buildDayPlan>['planned']; muted?: boolean }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-secondary">{title} ({items.length})</h4>
      <ul className={`divide-y rounded-md border bg-white text-sm ${muted ? 'opacity-80' : ''}`}>
        {items.map((i) => (
          <li key={`${i.kind}-${i.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>{i.title}{i.due && <span className="ml-2 text-xs text-secondary">due {fmtDate(i.due)}</span>}</span>
            <span className="flex items-center gap-1.5"><Badge tone={i.kind === 'task' ? 'neutral' : 'accent'}>{i.kind === 'task' ? 'Task' : 'Recommended'}</Badge><span className="text-xs text-secondary">{mins(i.minutes)}{i.assumed ? ' (assumed)' : ''}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeeklyReviewPanel({ data, recs, timeline, now }: { data: OverviewData; recs: StoredRecommendation[]; timeline: DeadlineRowView[]; now: Date }) {
  const atRisk = new Set(timeline.filter((r) => r.risk !== 'green').map((r) => r.app.id));
  const w = buildWeeklyReview({ tasks: data.tasks, applications: data.applications, deadlines: data.deadlines, schools: data.schools, recs, atRiskAppIds: atRisk, now });
  const Trend = w.progress === 'up' ? ArrowUp : w.progress === 'down' ? ArrowDown : Minus;
  return (
    <Card>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Progress</h4>
          {w.progress === 'no_data' ? <p className="mt-1 text-sm text-secondary">No tasks were completed in the last two weeks.</p> : (
            <p className="mt-1 flex items-center gap-1.5 text-sm"><Trend size={14} aria-hidden /> {w.completedThisWeek} completed in the last 7 days vs {w.completedLastWeek} the 7 days before
              {w.progress !== 'same' && <span className="text-secondary">({w.delta > 0 ? '+' : ''}{w.delta})</span>}</p>
          )}
          <p className="mt-1 text-sm">{w.incompleteTasks} task{w.incompleteTasks === 1 ? '' : 's'} incomplete{w.overdueTasks > 0 && <span className="text-danger">, {w.overdueTasks} overdue</span>}.</p>
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-secondary">Deadlines in the next 7 days</h4>
          {w.deadlinesNext7.length === 0 ? <p className="mt-1 text-sm text-secondary">None.</p> : (
            <ul className="mt-1 space-y-0.5 text-sm">{w.deadlinesNext7.map((d) => <li key={d.deadline.id}>{d.school?.short_name || d.school?.name}: {d.deadline.name}, {formatInZone(d.deadline.due_at, d.deadline.timezone)}</li>)}</ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-secondary">Schools needing attention</h4>
          {w.needsAttention.length === 0 ? <p className="mt-1 text-sm text-secondary">No school is flagged (no at-risk deadlines or overdue tasks).</p> : (
            <ul className="mt-1 space-y-1 text-sm">{w.needsAttention.map((s) => <li key={s.school}><span className="font-medium">{s.school}</span><span className="block text-xs text-secondary">{s.reasons.join('; ')}</span></li>)}</ul>
          )}
          <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-secondary">Recommended priorities</h4>
          {w.priorities.length === 0 ? <p className="mt-1 text-sm text-secondary">No open recommendations.</p> : <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">{w.priorities.map((p) => <li key={p.title}>{p.title}</li>)}</ol>}
          <p className="mt-3 text-xs"><Link className="text-accent underline" href="/applications?view=tasks">See all tasks</Link></p>
        </div>
      </div>
    </Card>
  );
}
