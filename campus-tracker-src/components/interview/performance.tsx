'use client';
import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { useQuery } from '@/lib/hooks';
import { SCORE_KEYS, SCORE_LABEL, canShowTrend, countEvaluatedAnswers, sessionPerformance, type FeedbackRow, type ScoreKey } from '@/lib/interview';
import type { Q, Sess } from './shared';

const COLORS: Record<string, string> = { overall: '#0f172a', clarity: '#2563eb', structure: '#16a34a', specificity: '#d97706', authenticity: '#9333ea', confidence: '#0891b2', leadership_evidence: '#dc2626', strategic_alignment: '#65a30d', relevance: '#db2777' };
export function Performance({ refreshKey }: { refreshKey: number }) {
  const sessions = useQuery<Sess[]>((sb) => sb.from('interview_sessions').select('*').eq('kind', 'mock'), [refreshKey]);
  const qs = useQuery<Pick<Q, 'id' | 'session_id'>[]>((sb) => sb.from('interview_questions').select('id,session_id').not('session_id', 'is', null), [refreshKey]);
  const fb = useQuery<FeedbackRow[]>((sb) => sb.from('interview_feedback').select('question_id,scores,source,created_at'), [refreshKey]);
  const [shown, setShown] = useState<Record<string, boolean>>({ overall: true });
  const evaluated = useMemo(() => countEvaluatedAnswers(fb.data ?? []), [fb.data]);
  const points = useMemo(() => sessionPerformance(sessions.data ?? [], qs.data ?? [], fb.data ?? []), [sessions.data, qs.data, fb.data]);
  if (sessions.loading || qs.loading || fb.loading) return <Loading />;
  const err = sessions.error || qs.error || fb.error; if (err) return <ErrorBox message={err} />;
  if (!canShowTrend(evaluated)) return <EmptyState title="Not enough evaluated answers yet" hint={`Performance charts appear after at least 2 answers have been evaluated by AI. You have ${evaluated}.`} />;
  const keys = ['overall', ...SCORE_KEYS] as const;
  const last = points[points.length - 1]; const first = points[0];
  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">AI-evaluated scores by session (1 to 10)</p><span className="text-xs text-secondary">{evaluated} evaluated answers across {points.length} session{points.length === 1 ? '' : 's'}</span></div>
        <div className="flex flex-wrap gap-3 text-xs">{keys.map((k) => <label key={k} className="flex items-center gap-1"><input type="checkbox" checked={!!shown[k]} onChange={(e) => setShown({ ...shown, [k]: e.target.checked })} /><span style={{ color: COLORS[k] }}>{k === 'overall' ? 'Overall' : SCORE_LABEL[k as ScoreKey]}</span></label>)}</div>
        <div className="h-72 w-full">
          <ResponsiveContainer><LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="label" /><YAxis domain={[1, 10]} ticks={[1, 3, 5, 7, 10]} /><Tooltip /><Legend />
            {keys.filter((k) => shown[k]).map((k) => <Line key={k} type="monotone" dataKey={k} name={k === 'overall' ? 'Overall' : SCORE_LABEL[k as ScoreKey]} stroke={COLORS[k]} strokeWidth={k === 'overall' ? 3 : 1.5} dot={{ r: 4 }} connectNulls isAnimationActive={false} />)}
          </LineChart></ResponsiveContainer>
        </div>
        {points.length < 2 && <p className="text-xs text-secondary">All evaluated answers are from one session so far, so there is no trend line yet. Complete another session to see change over time.</p>}
        <p className="text-xs text-secondary">Sessions: {points.map((p) => `${p.label} = ${p.date} (${p.count} answer${p.count === 1 ? '' : 's'})`).join(', ')}. Self-scores are excluded.</p>
      </Card>
      {first && last && points.length >= 2 && (
        <Card><p className="mb-2 font-medium">First vs latest session</p>
          <table className="w-full text-sm"><thead><tr className="text-left text-xs text-secondary"><th className="py-1">Dimension</th><th>{first.label}</th><th>{last.label}</th><th>Change</th></tr></thead><tbody>
            {SCORE_KEYS.map((k) => { const a = first[k]; const b = last[k]; return <tr key={k} className="border-t"><td className="py-1">{SCORE_LABEL[k]}</td><td>{a ?? '-'}</td><td>{b ?? '-'}</td><td>{a != null && b != null ? (b - a > 0 ? '+' : '') + (Math.round((b - a) * 10) / 10) : '-'}</td></tr>; })}
          </tbody></table>
        </Card>
      )}
    </div>
  );
}
