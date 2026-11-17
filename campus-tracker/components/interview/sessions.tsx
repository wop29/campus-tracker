'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AiLabel, Badge, Card, ConfirmButton, EmptyState, ErrorBox, Loading } from '@/components/ui';
import { useQuery, must } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { fmtDateTime, titleCase } from '@/lib/utils';
import { fmtDuration } from '@/lib/interview';
import { OriginBadge, ScoreGrid, type FB, type Q, type School, type Sess } from './shared';

type Assess = { subject_id: string; result: { practice_questions?: string[] } };
export function PastSessions({ schools, refreshKey, onChanged }: { schools: School[]; refreshKey: number; onChanged: () => void }) {
  const toast = useToast();
  const sessions = useQuery<Sess[]>((sb) => sb.from('interview_sessions').select('*').eq('kind', 'mock').order('started_at', { ascending: false, nullsFirst: false }), [refreshKey]);
  const [open, setOpen] = useState<string | null>(null);
  const del = async (id: string) => { try { await must(supabaseBrowser().from('interview_sessions').delete().eq('id', id).select('id')); toast('Session deleted'); setOpen(null); await sessions.reload(); onChanged(); } catch (e) { toast((e as Error).message, 'err'); } };
  if (sessions.loading) return <Loading />;
  if (sessions.error) return <ErrorBox message={sessions.error} onRetry={sessions.reload} />;
  if (!sessions.data?.length) return <EmptyState title="No mock interviews yet" hint="Start one from the Mock interview tab. Saved sessions appear here for review." />;
  return (
    <div className="space-y-2">
      {sessions.data.map((s) => (
        <Card key={s.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button className="text-left" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <span className="font-medium">{fmtDateTime(s.started_at ?? s.created_at)}</span>
              <span className="ml-2 text-sm text-secondary">{schools.find((x) => x.id === s.school_id)?.name ?? 'No school'}{s.duration_seconds != null ? ` | ${fmtDuration(s.duration_seconds)}` : ''}</span>
            </button>
            <div className="flex items-center gap-2"><Badge tone={s.status === 'completed' ? 'success' : s.status === 'in_progress' ? 'warning' : 'neutral'}>{titleCase(s.status)}</Badge>
              <ConfirmButton size="sm" variant="ghost" message="Delete this session and its answers?" onConfirm={() => void del(s.id)} aria-label="Delete session"><Trash2 size={12} /></ConfirmButton></div>
          </div>
          {open === s.id && <Detail sessionId={s.id} />}
        </Card>
      ))}
    </div>
  );
}
function Detail({ sessionId }: { sessionId: string }) {
  const qs = useQuery<Q[]>((sb) => sb.from('interview_questions').select('*').eq('session_id', sessionId).order('asked_order'), [sessionId]);
  const ids = (qs.data ?? []).map((q) => q.id);
  const fb = useQuery<FB[]>((sb) => (ids.length ? sb.from('interview_feedback').select('*').in('question_id', ids).order('created_at') : Promise.resolve({ data: [], error: null })), [ids.join(',')]);
  const as = useQuery<Assess[]>((sb) => (ids.length ? sb.from('ai_assessments').select('subject_id,result').eq('kind', 'interview').in('subject_id', ids).order('created_at') : Promise.resolve({ data: [], error: null })), [ids.join(',')]);
  if (qs.loading) return <Loading />;
  if (qs.error) return <ErrorBox message={qs.error} />;
  return (
    <ol className="space-y-3 border-t pt-3">
      {qs.data!.map((q, i) => {
        const f = (fb.data ?? []).filter((x) => x.question_id === q.id); const ai = [...f].reverse().find((x) => x.source === 'ai'); const sf = [...f].reverse().find((x) => x.source === 'self');
        const practice = [...(as.data ?? [])].reverse().find((a) => a.subject_id === q.id)?.result.practice_questions ?? [];
        return (
          <li key={q.id} className="space-y-1.5 text-sm">
            <p className="font-medium">{i + 1}. {q.question}</p><div className="flex flex-wrap items-center gap-2 text-xs text-secondary"><Badge tone="neutral">{q.category}</Badge><OriginBadge q={q} /></div>
            <p className="whitespace-pre-wrap rounded bg-bg p-2">{q.answer || <span className="text-secondary">No answer recorded.</span>}</p>
            {ai && <div className="space-y-1"><div className="flex items-center gap-2 text-xs font-medium text-secondary">AI feedback <AiLabel /></div><ScoreGrid scores={ai.scores} /><p className="whitespace-pre-wrap">{ai.feedback}</p>{!!practice.length && <ul className="ml-4 list-disc text-xs text-secondary">{practice.map((p, k) => <li key={k}>{p}</li>)}</ul>}</div>}
            {sf && <div><p className="text-xs font-medium text-secondary">Your self-score</p><ScoreGrid scores={sf.scores} /></div>}
          </li>
        );
      })}
    </ol>
  );
}
