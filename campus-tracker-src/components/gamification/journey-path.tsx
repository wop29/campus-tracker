'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Crown, SkipForward } from 'lucide-react';
import { Mascot, type MascotMood } from '@/components/mascot';
import type { Journey, Lesson, Unit } from '@/lib/journey';
import { cn } from '@/lib/utils';
import { ProgressRing } from './progress-ring';

const FILL: Record<string, string> = { green: 'bg-fun-green border-fun-green-dark', blue: 'bg-fun-blue border-fun-blue-dark', orange: 'bg-fun-orange border-fun-orange-dark', pink: 'bg-fun-pink border-fun-pink-dark', yellow: 'bg-fun-yellow border-fun-yellow-dark', purple: 'bg-fun-purple border-fun-purple-dark' };
const SOFT: Record<string, string> = { green: 'bg-fun-green/15', blue: 'bg-fun-blue/15', orange: 'bg-fun-orange/15', pink: 'bg-fun-pink/15', yellow: 'bg-fun-yellow/20', purple: 'bg-fun-purple/15' };

function Node({ lesson, unit, n, mood }: { lesson: Lesson; unit: Unit; n: number; mood: MascotMood }) {
  const offset = [0, 32, 56, 32][n % 4];
  const done = lesson.state === 'done', current = lesson.state === 'current', skipped = lesson.state === 'skipped';
  const status = done ? 'done' : current ? 'do this next' : skipped ? 'skipped, optional' : 'not done yet';
  return (
    <li className="relative" style={{ marginLeft: offset }}>
      <Link href={lesson.href} aria-label={`${lesson.title}, ${status}`} className="group flex items-center gap-3 rounded-2xl p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        {current && <span className="absolute right-full top-1/2 mr-1 hidden -translate-y-1/2 motion-safe:animate-bounce sm:block" aria-hidden><Mascot mood={mood} size={52} /></span>}
        <span className={cn('flex shrink-0 items-center justify-center rounded-full border-b-4 text-on-fun transition-transform group-hover:-translate-y-0.5',
          current ? 'h-16 w-16 ring-4 ring-offset-2 ring-fun-yellow ' + FILL[unit.color] : 'h-14 w-14',
          done ? FILL[unit.color] : !current && (skipped ? 'border-dashed border-line/40 bg-bg text-secondary' : 'border-line/40 bg-border text-secondary'))}>
          {done ? <Check size={26} strokeWidth={3} aria-hidden /> : skipped ? <SkipForward size={20} aria-hidden /> : <span className="text-lg font-extrabold">{n + 1}</span>}
        </span>
        <span className="min-w-0">
          <span className={cn('block text-sm font-extrabold', (done || skipped) && 'text-secondary')}>{lesson.title}</span>
          <span className="block text-xs text-secondary">{current ? lesson.hint : done ? 'Done' : skipped ? 'Skipped, optional' : lesson.target > 1 ? `${lesson.current} of ${lesson.target}` : 'Coming up'}</span>
        </span>
      </Link>
    </li>
  );
}

/** One unit per row. Only the unit with the current lesson starts open; the rest stay collapsed until tapped. */
export function JourneyPath({ journey, mood = 'happy' }: { journey: Journey; mood?: MascotMood }) {
  const defaultOpen = journey.currentUnitId ?? journey.units[journey.units.length - 1]?.id ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen ? [defaultOpen] : []));
  const toggle = (id: string) => setOpen((cur) => { const s = new Set(cur); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  let n = 0;
  return (
    <ol className="space-y-3" aria-label="Your path">
      {journey.units.map((u) => {
        const start = n; n += u.lessons.length;
        const isOpen = open.has(u.id), isCurrent = u.id === journey.currentUnitId;
        const allSkipped = u.total === 0;
        return (
          <li key={u.id}>
            <section aria-labelledby={`unit-${u.id}`}>
              <button type="button" onClick={() => toggle(u.id)} aria-expanded={isOpen} aria-controls={`unit-body-${u.id}`}
                className={cn('flex w-full items-center gap-3 rounded-2xl border-2 border-b-4 p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                  isCurrent || u.crowned ? FILL[u.color] + ' text-on-fun' : 'border-border bg-surface text-ink')}>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wide opacity-80">Part {u.index + 1}{isCurrent ? ' · You are here' : ''}</span>
                  <span id={`unit-${u.id}`} className="flex items-center gap-1.5 text-base font-extrabold">{u.title}{u.crowned && <><Crown size={18} aria-hidden /><span className="sr-only">Completed</span></>}</span>
                  <span className="block text-xs">{allSkipped ? 'Skipped for now. Optional.' : `${u.blurb} ${u.doneCount} of ${u.total} done.`}</span>
                </span>
                {!allSkipped && <ProgressRing pct={u.pct} size={44} stroke={5} color={u.color} label={`${u.title} progress`} className="rounded-full bg-white/80" />}
                <ChevronDown size={20} aria-hidden className={cn('shrink-0 transition-transform', isOpen && 'rotate-180')} />
              </button>
              {isOpen && (
                <ul id={`unit-body-${u.id}`} className={cn('mt-2 space-y-3 rounded-2xl py-3 pl-4 pr-3 sm:pl-[68px]', SOFT[u.color])}>
                  {u.lessons.map((l, i) => <Node key={l.id} lesson={l} unit={u} n={start + i} mood={mood} />)}
                </ul>
              )}
            </section>
          </li>
        );
      })}
    </ol>
  );
}
