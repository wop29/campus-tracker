'use client';
import * as Icons from 'lucide-react';
import type { Badge } from '@/lib/gamification';
import { ArtImg } from '@/components/art';
import { fmtDate } from '@/lib/utils';
import { cn } from '@/lib/utils';

const FILL: Record<string, string> = { green: 'bg-fun-green border-fun-green-dark', blue: 'bg-fun-blue border-fun-blue-dark', orange: 'bg-fun-orange border-fun-orange-dark', pink: 'bg-fun-pink border-fun-pink-dark', yellow: 'bg-fun-yellow border-fun-yellow-dark', purple: 'bg-fun-purple border-fun-purple-dark' };

export function BadgeShelf({ badges, nextUp }: { badges: Badge[]; nextUp: Badge[] }) {
  const unlocked = badges.filter((b) => b.unlocked).length;
  return (
    <div>
      <p className="mb-3 text-xs text-secondary">{unlocked} of {badges.length} unlocked. Badges come from real records only.</p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {badges.map((b) => {
          const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[b.icon] ?? Icons.Star;
          return (
            <li key={b.id} className={cn('rounded-2xl border bg-surface p-3 text-center', !b.unlocked && !b.art && 'opacity-80')}>
              {b.art
                // The ribbon on the art is blank on purpose: the badge name is the HTML text below it.
                ? <span className="relative mx-auto block h-[84px] w-[84px]">
                    <ArtImg src={b.art} alt="" size={84} className={cn(!b.unlocked && 'opacity-50 grayscale')} />
                    {!b.unlocked && <span className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-surface text-secondary" aria-hidden><Icons.Lock size={12} /></span>}
                  </span>
                : <span className="flex h-[84px] items-center justify-center">
                    <span className={cn('flex h-16 w-16 items-center justify-center rounded-full border-b-4 text-on-fun', b.unlocked ? FILL[b.color] : 'border-line/40 bg-border text-secondary')}>
                      {b.unlocked ? <Icon size={28} aria-hidden /> : <Icons.Lock size={22} aria-hidden />}
                    </span>
                  </span>}
              <p className="mt-2 text-sm font-extrabold">{b.title}</p>
              <p className="text-xs text-secondary">{b.unlocked ? `Unlocked ${fmtDate(b.unlockedAt)}` : `${b.current} of ${b.target}`}</p>
              <span className="sr-only">{b.unlocked ? 'Unlocked' : 'Locked'}. {b.description}</span>
            </li>
          );
        })}
      </ul>
      {nextUp.length > 0 && (
        <div className="mt-4 rounded-2xl border bg-surface p-3">
          <h3 className="text-sm font-extrabold">Next badges</h3>
          <ul className="mt-1 space-y-1 text-xs text-secondary">
            {nextUp.map((b) => <li key={b.id}><span className="font-bold text-ink">{b.title}</span> ({b.current} of {b.target}): {b.hint}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
