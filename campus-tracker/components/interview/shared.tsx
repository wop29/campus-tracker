'use client';
import { Badge } from '@/components/ui';
import { ORIGIN_LABEL, SCORE_KEYS, SCORE_LABEL, overallScore, cleanScores } from '@/lib/interview';

export type Q = { id: string; session_id: string | null; school_id: string | null; category: string; question: string; origin: 'ai_generated' | 'verified_historical' | 'user'; answer: string | null; asked_order: number | null; source_note: string | null; created_at: string };
export type Sess = { id: string; application_id: string | null; school_id: string | null; kind: 'mock' | 'real'; scheduled_at: string | null; interviewer: string | null; format: string | null; started_at: string | null; ended_at: string | null; duration_seconds: number | null; status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled'; notes: string | null; created_at: string };
export type FB = { id: string; question_id: string; scores: unknown; feedback: string | null; source: 'ai' | 'self'; created_at: string };
export type School = { id: string; name: string };

export function OriginBadge({ q }: { q: Pick<Q, 'origin' | 'source_note'> }) {
  const tone = q.origin === 'ai_generated' ? 'accent' : q.origin === 'verified_historical' ? 'success' : 'neutral';
  return <span title={q.source_note ? `Source: ${q.source_note}` : undefined}><Badge tone={tone}>{ORIGIN_LABEL[q.origin]}</Badge></span>;
}
export function ScoreGrid({ scores }: { scores: unknown }) {
  const s = cleanScores(scores); const o = overallScore(s);
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {SCORE_KEYS.map((k) => <div key={k} className="flex justify-between border-b py-0.5"><span className="text-secondary">{SCORE_LABEL[k]}</span><span className="font-medium">{s[k] ?? '-'}</span></div>)}
      </div>
      {o !== null && <p className="mt-1 text-xs text-secondary">Average: {o}/10</p>}
    </div>
  );
}
