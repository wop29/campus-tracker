import { AlertTriangle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { daysUntil, deadlineFlag, verificationFlag, type ScholarshipRow } from '@/lib/scholarships';

export function Flags({ s, today }: { s: ScholarshipRow; today: string }) {
  const d = deadlineFlag(s, today); const v = verificationFlag(s.source_verified_on, today);
  const days = daysUntil(s.deadline, today);
  return (
    <div className="flex flex-wrap gap-1">
      {d === 'overdue' && <Badge tone="danger"><Clock size={11} className="mr-1" />Overdue by {Math.abs(days!)} day(s)</Badge>}
      {d === 'soon' && <Badge tone="warning"><Clock size={11} className="mr-1" />{days === 0 ? 'Due today' : `Due in ${days} day(s)`}</Badge>}
      {v !== 'ok' && <Badge tone="warning"><AlertTriangle size={11} className="mr-1" />{v === 'missing' ? 'No verification date: verify before relying on this' : 'Verified over 12 months ago: verify before relying on this'}</Badge>}
    </div>
  );
}
