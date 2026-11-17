'use client';
import { useMemo } from 'react';
import { Badge, EmptyState } from '@/components/ui';
import { compareBySchool, totalsByCurrency, type ScholarshipRow } from '@/lib/scholarships';
import { titleCase } from '@/lib/utils';
import { money } from '@/components/finance/shared';

/** Side-by-side per school. Currencies are shown as separate subtotals because scholarships store no exchange rate. */
export function ScholarshipCompare({ rows, schoolName }: { rows: ScholarshipRow[]; schoolName: (id: string | null) => string }) {
  const groups = useMemo(() => compareBySchool(rows).sort((a, b) => (schoolName(a.schoolId) || '~').localeCompare(schoolName(b.schoolId) || '~')), [rows, schoolName]);
  if (!rows.length) return <EmptyState title="Nothing to compare" hint="Add scholarships and link them to schools to compare funding side by side." />;
  const all = totalsByCurrency(rows);
  const multi = Object.keys(all).length > 1;
  return (
    <div className="space-y-3">
      <p className="text-xs text-secondary">Based on the amounts you entered for the scholarships currently shown by your filters, regardless of status or whether you are eligible. Totals are per currency{multi ? ' and are not added together because no exchange rate is recorded for scholarships' : ''}.</p>
      <div className="overflow-x-auto rounded-lg border bg-surface"><table className="w-full text-sm">
        <thead className="bg-bg text-left text-xs text-secondary"><tr><th scope="col" className="px-3 py-2">School</th><th scope="col" className="px-3 py-2">Scholarships</th><th scope="col" className="px-3 py-2">Total per currency</th><th scope="col" className="px-3 py-2">Pipeline</th></tr></thead>
        <tbody className="divide-y">{groups.map((g) => {
          const rs = rows.filter((r) => (r.school_id ?? null) === g.schoolId);
          const counts = rs.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
          return (
            <tr key={g.schoolId ?? 'none'} className="align-top">
              <th scope="row" className="px-3 py-2 text-left font-medium">{g.schoolId ? schoolName(g.schoolId) : 'No linked school'}</th>
              <td className="px-3 py-2"><ul className="space-y-0.5">{rs.map((r) => <li key={r.id}>{r.name} <span className="text-xs text-secondary">{r.amount == null ? '(no amount)' : `(${money(r.amount, r.currency)})`}</span></li>)}</ul></td>
              <td className="px-3 py-2 tabular-nums">{Object.keys(g.totalsByCurrency).length ? Object.entries(g.totalsByCurrency).map(([c, v]) => <div key={c}>{money(v, c)}</div>) : '-'}{g.withoutAmount > 0 && <div className="text-xs text-secondary">{g.withoutAmount} without an amount</div>}</td>
              <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{Object.entries(counts).map(([k, v]) => <Badge key={k}>{titleCase(k)} {v}</Badge>)}</div></td>
            </tr>);
        })}
          <tr className="bg-bg font-medium"><th scope="row" className="px-3 py-2 text-left">All shown</th><td className="px-3 py-2">{rows.length}</td><td className="px-3 py-2 tabular-nums" colSpan={2}>{Object.entries(all).map(([c, v]) => money(v, c)).join('  |  ') || '-'}</td></tr>
        </tbody>
      </table></div>
    </div>
  );
}
