'use client';
import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui';
import { useToast } from '@/components/toast';
import { DAILY_GOAL_MAX, DAILY_GOAL_MIN, dailyGoalSchema } from '@/lib/gamification';

/** Inline daily XP goal (10 to 200), stored at settings.gamification.daily_goal_xp. */
export function DailyGoalControl({ value, onSave }: { value: number; onSave: (n: number) => Promise<void> }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setText(String(value)); }, [value, editing]);
  const save = async () => {
    const r = dailyGoalSchema.safeParse(text);
    if (!r.success) { setErr(r.error.issues[0].message); return; }
    setBusy(true); setErr(null);
    try { await onSave(r.data); toast('Daily goal saved'); setEditing(false); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  if (!editing) return <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-full border bg-surface px-3 py-1 text-xs font-bold hover:bg-bg" aria-label={`Daily goal ${value} XP. Edit`}><Pencil size={12} aria-hidden />Daily goal: {value} XP</button>;
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label htmlFor="daily-goal" className="text-xs font-bold">Daily goal (XP)</label>
      <input id="daily-goal" type="number" inputMode="numeric" min={DAILY_GOAL_MIN} max={DAILY_GOAL_MAX} step={1} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!err} aria-describedby={err ? 'daily-goal-err' : undefined} className="w-20 rounded-md border border-line bg-white px-2 py-1 text-sm" />
      <Button size="sm" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => { setEditing(false); setErr(null); }}>Cancel</Button>
      {err && <span id="daily-goal-err" role="alert" className="text-xs text-danger-ink">{err}</span>}
    </form>
  );
}
