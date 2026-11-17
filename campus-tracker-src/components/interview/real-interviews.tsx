'use client';
import { Badge, Button, Card, ErrorBox, Loading } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { fmtDateTime, titleCase } from '@/lib/utils';
import type { School, Sess } from './shared';

/** Real interviews scheduled by the Applications module. Read-only here, with a shortcut into school-specific prep. */
export function RealInterviews({ schools, onPrep }: { schools: School[]; onPrep: (schoolId: string) => void }) {
  const r = useQuery<Sess[]>((sb) => sb.from('interview_sessions').select('*').eq('kind', 'real').order('scheduled_at', { ascending: true, nullsFirst: false }));
  if (r.loading) return <Loading />;
  if (r.error) return <ErrorBox message={r.error} onRetry={r.reload} />;
  if (!r.data?.length) return <p className="rounded-lg border border-dashed bg-white p-4 text-sm text-secondary">No real interviews scheduled. When you mark an application as interview scheduled, it appears here.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {r.data.map((s) => (
        <Card key={s.id} className="space-y-1.5">
          <div className="flex items-center justify-between gap-2"><p className="font-medium">{schools.find((x) => x.id === s.school_id)?.name ?? 'School not set'}</p><Badge tone={s.status === 'completed' ? 'success' : s.status === 'cancelled' ? 'neutral' : 'accent'}>{titleCase(s.status)}</Badge></div>
          <p className="text-sm text-secondary">{s.scheduled_at ? fmtDateTime(s.scheduled_at) : 'Date not set'}{s.format ? ` | ${s.format}` : ''}{s.interviewer ? ` | ${s.interviewer}` : ''}</p>
          {s.notes && <p className="text-sm">{s.notes}</p>}
          <Button size="sm" disabled={!s.school_id} onClick={() => s.school_id && onPrep(s.school_id)}>Start prep for this school</Button>
        </Card>
      ))}
    </div>
  );
}
