'use client';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Select } from '@/components/ui';
import { SCHOLARSHIP_STATUSES, type ScholarshipRow } from '@/lib/scholarships';
import { fmtDate, titleCase } from '@/lib/utils';
import { money } from '@/components/finance/shared';
import { Flags } from './flags';

type Common = { rows: ScholarshipRow[]; today: string; schoolName: (id: string | null) => string; onOpen: (s: ScholarshipRow) => void; onEdit: (s: ScholarshipRow) => void; onDelete: (s: ScholarshipRow) => void; onStatus: (s: ScholarshipRow, status: string) => void; busyId: string | null };

export function ScholarshipTable({ rows, today, schoolName, onOpen, onEdit, onDelete, busyId }: Common) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-surface"><table className="w-full text-sm">
      <thead className="bg-bg text-left text-xs text-secondary"><tr>{['Scholarship', 'School', 'Amount', 'Deadline', 'Status', 'Eligibility', ''].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
      <tbody className="divide-y">{rows.map((s) => (
        <tr key={s.id} className="align-top">
          <td className="px-3 py-2"><button className="text-left font-medium hover:underline" onClick={() => onOpen(s)}>{s.name}</button>{s.institution && <div className="text-xs text-secondary">{s.institution}</div>}<Flags s={s} today={today} /></td>
          <td className="px-3 py-2">{schoolName(s.school_id) || '-'}</td>
          <td className="px-3 py-2 tabular-nums">{s.amount == null ? '-' : money(s.amount, s.currency)}</td>
          <td className="px-3 py-2">{fmtDate(s.deadline)}</td>
          <td className="px-3 py-2"><Badge tone={s.status === 'awarded' ? 'success' : s.status === 'rejected' ? 'danger' : 'neutral'}>{titleCase(s.status)}</Badge></td>
          <td className="px-3 py-2">{s.eligibility_checked ? <Badge tone="success">Confirmed by me</Badge> : <span className="text-xs text-secondary">Not confirmed</span>}</td>
          <td className="whitespace-nowrap px-3 py-2 text-right">
            <Button size="sm" variant="ghost" aria-label={`View ${s.name}`} onClick={() => onOpen(s)}><Eye size={14} /></Button>
            <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)}><Pencil size={14} /></Button>
            <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} disabled={busyId === s.id} onClick={() => onDelete(s)}><Trash2 size={14} /></Button>
          </td>
        </tr>))}</tbody>
    </table></div>
  );
}

export function ScholarshipBoard({ rows, today, schoolName, onOpen, onEdit, onStatus, busyId }: Common) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {SCHOLARSHIP_STATUSES.map((st) => {
        const col = rows.filter((r) => r.status === st);
        return (
          <section key={st} className="w-64 shrink-0" aria-label={titleCase(st)}>
            <h3 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-secondary">{titleCase(st)} <span className="rounded-full bg-bg px-1.5">{col.length}</span></h3>
            <div className="space-y-2">{col.length === 0 && <p className="rounded-md border border-dashed p-3 text-xs text-secondary">Empty</p>}
              {col.map((s) => (
                <Card key={s.id} className="p-3">
                  <button className="text-left text-sm font-medium hover:underline" onClick={() => onOpen(s)}>{s.name}</button>
                  <p className="mt-0.5 text-xs text-secondary">{schoolName(s.school_id) || s.institution || 'No school'}</p>
                  <p className="mt-1 text-xs tabular-nums">{s.amount == null ? 'No amount' : money(s.amount, s.currency)}{s.deadline ? ` · ${fmtDate(s.deadline)}` : ''}</p>
                  <div className="mt-1"><Flags s={s} today={today} /></div>
                  <div className="mt-2 flex items-center gap-1"><Select aria-label={`Move ${s.name}`} className="!py-1 text-xs" disabled={busyId === s.id} value={s.status} onChange={(e) => onStatus(s, e.target.value)}>{SCHOLARSHIP_STATUSES.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)}><Pencil size={12} /></Button></div>
                </Card>))}</div>
          </section>);
      })}
    </div>
  );
}
