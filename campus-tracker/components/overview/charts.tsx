'use client';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui';
import type { Count, Rate } from '@/lib/analytics';
import { SMALL_SAMPLE } from '@/lib/analytics';

const AXIS = { fontSize: 11, fill: '#344761' };

export function BarCard({ title, data, note, horizontal, color = '#5379B8' }: { title: string; data: Count[]; note?: string; horizontal?: boolean; color?: string }) {
  const total = data.reduce((a, b) => a + b.value, 0);
  const summary = `${title}: ${data.filter((d) => d.value).map((d) => `${d.name} ${d.value}`).join(', ') || 'no data'}`;
  return (
    <Card>
      <h3 className="text-sm font-semibold">{title}</h3>
      {note && <p className="text-xs text-secondary">{note}</p>}
      {total === 0 ? <p className="py-10 text-center text-sm text-secondary">Not enough data yet</p> : (
        <div role="img" aria-label={summary} className="mt-3" style={{ height: horizontal ? Math.max(180, data.length * 30 + 30) : 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ left: horizontal ? 8 : -16, right: 12, top: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={!horizontal} vertical={!!horizontal} />
              {horizontal ? <><XAxis type="number" allowDecimals={false} tick={AXIS} /><YAxis type="category" dataKey="name" width={110} tick={AXIS} /></> : <><XAxis dataKey="name" tick={AXIS} interval={0} /><YAxis allowDecimals={false} tick={AXIS} /></>}
              <Tooltip cursor={{ fill: '#F7F8FA' }} formatter={(v) => [v as number, 'Count']} />
              <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-xs text-secondary">n = {total}</p>
    </Card>
  );
}

/** A percentage that is only shown when there is at least one observation. Always shows n. */
export function RateCard({ label, rate, detail }: { label: string; rate: Rate; detail?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium text-secondary">{label}</p>
      {rate.pct == null ? <p className="mt-1 text-lg font-semibold text-secondary">Not enough data yet</p> : <p className="mt-1 text-2xl font-semibold">{rate.pct}%</p>}
      <p className="mt-0.5 text-xs text-secondary">{rate.numerator} of n = {rate.n}{detail ? `. ${detail}` : ''}</p>
      {rate.pct != null && rate.n < SMALL_SAMPLE && <p className="mt-0.5 text-xs text-warning">Small sample, read with caution.</p>}
    </Card>
  );
}
export const StatCard = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
  <Card><p className="text-xs font-medium text-secondary">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p>{sub && <p className="mt-0.5 text-xs text-secondary">{sub}</p>}</Card>
);
