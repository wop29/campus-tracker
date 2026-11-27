'use client';
// Handy answers while writing an essay: goals, work, education and test scores from the profile, each with a Copy button.
// Nothing is required. If the student has not filled anything in, this just points to where they can.
import Link from 'next/link';
import { useMemo } from 'react';
import { Copy } from 'lucide-react';
import { Card, Loading } from '@/components/ui';
import { useToast } from '@/components/toast';
import { useQuery } from '@/lib/hooks';
import { parseOnboarding } from '@/lib/onboarding';
import type { EducationRow, GoalsRow, TestRow, WorkRow } from '@/lib/profile';
import { buildStory } from '@/lib/story';

export function YourStoryPanel() {
  const toast = useToast();
  const settings = useQuery<{ settings: unknown } | null>((sb) => sb.from('applicant_profiles').select('settings').maybeSingle(), []);
  const goals = useQuery<GoalsRow | null>((sb) => sb.from('career_goals').select('*').maybeSingle(), []);
  const work = useQuery<WorkRow[]>((sb) => sb.from('work_experiences').select('*').is('deleted_at', null).order('start_date', { ascending: false, nullsFirst: false }), []);
  const education = useQuery<EducationRow[]>((sb) => sb.from('education_records').select('*').is('deleted_at', null).order('graduation_date', { ascending: false, nullsFirst: false }), []);
  const tests = useQuery<TestRow[]>((sb) => sb.from('test_scores').select('*').is('deleted_at', null).order('test_date', { ascending: false, nullsFirst: false }), []);
  const loading = [settings, goals, work, education, tests].some((q) => q.loading && q.data === null);
  const ob = parseOnboarding(settings.data?.settings);
  const blocks = useMemo(() => buildStory({ track: ob.track, ...(ob.program ? { program: ob.program } : {}), goals: goals.data ?? null, work: work.data ?? [], education: education.data ?? [], tests: tests.data ?? [] }),
    [ob.track, ob.program, goals.data, work.data, education.data, tests.data]);

  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); toast(`Copied: ${label}`); } catch { toast('Could not copy. Select the text and copy it by hand.'); }
  }
  return (
    <Card className="space-y-2">
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Your story: answers to reuse</summary>
        <p className="mt-2 text-xs text-secondary">The things schools ask again and again. Copy what helps. Nothing here is required.</p>
        {loading ? <div className="mt-2"><Loading /></div> : blocks.length === 0 ? (
          <p className="mt-2 text-sm text-secondary">Nothing saved yet. Add your goals, work and scores in <Link href="/profile" className="font-semibold text-accent underline">Your story</Link> when you are ready, and they will show up here.</p>
        ) : (
          <div className="mt-3 space-y-4">
            {blocks.map((b) => (
              <section key={b.key} aria-label={b.title}>
                <h3 className="mb-1 text-xs font-bold uppercase tracking-wide text-secondary">{b.title}</h3>
                <ul className="space-y-2">
                  {b.items.map((it, i) => (
                    <li key={`${b.key}-${i}`} className="rounded-xl border-2 bg-bg p-2.5 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold">{it.label}</p>
                        <button type="button" onClick={() => void copy(it.text, it.label)} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border-2 px-2 text-xs font-bold text-secondary hover:bg-surface hover:text-ink" aria-label={`Copy ${it.label}`}><Copy size={12} /> Copy</button>
                      </div>
                      <p className="mt-1 whitespace-pre-line text-secondary">{it.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <Link href="/profile" className="inline-block text-xs font-semibold text-accent underline">Edit in Your story</Link>
          </div>
        )}
      </details>
    </Card>
  );
}
