'use client';
import Link from 'next/link';
import { ArrowRight, PartyPopper } from 'lucide-react';
import type { NextStep } from '@/lib/journey';

/** The single "do this next" step from lib/journey.ts, shown first on the Overview. Same step and number as the Journey page. */
export function NextStepCard({ step, total }: { step: NextStep | null; total: number }) {
  if (!step) return (
    <div className="rounded-2xl border-2 border-b-4 border-fun-purple-dark bg-fun-purple p-4 text-on-fun" role="status">
      <p className="flex items-center gap-2 text-base font-extrabold"><PartyPopper size={18} aria-hidden />Your path is complete</p>
      <p className="mt-1 text-sm font-bold">All {total} steps are done. Keep an eye on your deadlines below.</p>
    </div>
  );
  return (
    <Link href={step.href} className="group flex min-h-[44px] flex-wrap items-center gap-3 rounded-2xl border-2 border-b-4 border-fun-green-dark bg-fun-green p-4 text-on-fun transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-extrabold uppercase tracking-wide opacity-80">Do this next · Step {step.step} of {step.total}{step.unitTitle ? ` · ${step.unitTitle}` : ''}</span>
        <span className="mt-0.5 block text-lg font-extrabold">{step.title}</span>
        <span className="block text-sm font-bold opacity-90">{step.hint}</span>
        {step.target > 1 && <span className="block text-xs font-bold">{step.current} of {step.target} so far</span>}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-b-4 border-fun-yellow-dark bg-fun-yellow px-4 py-2 text-sm font-extrabold transition group-hover:-translate-y-0.5">{step.current > 0 ? 'Keep going' : 'Start'}<ArrowRight size={16} aria-hidden /></span>
    </Link>
  );
}
