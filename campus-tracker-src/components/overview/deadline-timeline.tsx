'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { z } from 'zod';
import { Button, Card, EmptyState, Input, RiskBadge } from '@/components/ui';
import { useToast } from '@/components/toast';
import { must } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { timeRemaining } from '@/lib/logic/risk';
import { formatInZone, utcToZonedLocal, zonedToUtcIso, type DeadlineRowView } from '@/lib/overview-logic';

const localSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a valid date and time');

export function DeadlineTimeline({ rows, now, onChanged, totalDeadlines }: { rows: DeadlineRowView[]; now: Date; onChanged: () => void; totalDeadlines: number }) {
  const toast = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const start = (r: DeadlineRowView) => { setEditing(r.deadline.id); setErr(null); try { setValue(utcToZonedLocal(r.deadline.due_at, r.deadline.timezone)); } catch { setValue(''); } };
  const save = async (r: DeadlineRowView) => {
    if (saving) return;
    const parsed = localSchema.safeParse(value);
    if (!parsed.success) { setErr(parsed.error.issues[0].message); return; }
    setSaving(true);
    try {
      const iso = zonedToUtcIso(value, r.deadline.timezone);
      const rows = await must(supabaseBrowser().from('deadlines').update({ due_at: iso }).eq('id', r.deadline.id).select('id'));
      if (!rows?.length) throw new Error('Deadline not found or not editable');
      toast('Deadline updated'); setEditing(null); onChanged();
    } catch (e) { setErr((e as Error).message); toast((e as Error).message, 'err'); }
    setSaving(false);
  };

  if (!rows.length) return <EmptyState title={totalDeadlines ? 'No deadlines in the next 30 days' : 'No deadlines yet'} hint={totalDeadlines ? 'Deadlines for unsubmitted applications appear here when they are within 30 days.' : 'Add deadlines to your applications to track them here.'} action={<Link href="/applications" className="text-sm text-accent underline">Open Applications</Link>} />;
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[56rem] text-left text-sm">
        <caption className="sr-only">Deadlines in the next 30 days</caption>
        <thead className="border-b bg-bg text-xs text-secondary"><tr>
          {['School', 'Deadline', 'Date and time', 'Time remaining', 'Requirements', 'Risk', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const id = r.deadline.id;
            return (
              <tr key={id} className="border-b last:border-0 align-top">
                <td className="px-3 py-2 font-medium">{r.school?.short_name || r.school?.name || 'School'}{r.app.round && <span className="ml-1 text-xs font-normal text-secondary">{r.app.round}</span>}</td>
                <td className="px-3 py-2">{r.deadline.name}</td>
                <td className="px-3 py-2">
                  {editing === id ? (
                    <div className="space-y-1">
                      <Input type="datetime-local" aria-label={`New date and time for ${r.deadline.name}`} value={value} onChange={(e) => setValue(e.target.value)} className="w-52" />
                      <p className="text-xs text-secondary">Time zone: {r.deadline.timezone}</p>
                      {err && <p className="text-xs text-danger" role="alert">{err}</p>}
                      <div className="flex gap-1"><Button size="sm" disabled={saving} onClick={() => save(r)}>{saving ? 'Saving...' : 'Save'}</Button><Button size="sm" variant="secondary" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button></div>
                    </div>
                  ) : formatInZone(r.deadline.due_at, r.deadline.timezone)}
                </td>
                <td className={`px-3 py-2 ${r.overdue ? 'text-danger' : ''}`}>{timeRemaining(r.deadline.due_at, now)}</td>
                <td className="px-3 py-2 text-xs"><span className="text-success">{r.done} done</span>, <span className={r.total - r.done ? 'text-warning' : 'text-secondary'}>{r.total - r.done} outstanding</span>{r.total === 0 && <span className="block text-secondary">No requirements</span>}</td>
                <td className="px-3 py-2"><RiskBadge risk={r.risk} /><span className="mt-0.5 block max-w-[14rem] text-xs text-secondary">{r.reason}</span></td>
                <td className="px-3 py-2">{editing !== id && <Button variant="ghost" size="sm" onClick={() => start(r)} aria-label={`Edit date and time for ${r.school?.name ?? 'school'} ${r.deadline.name}`}><Pencil size={12} /> Edit</Button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
