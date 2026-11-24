'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Flame, Zap } from 'lucide-react';
import { useXpSummary } from './use-gamification';
import { cn } from '@/lib/utils';

/** Header chips: streak, XP and level. Real numbers only; renders nothing until they load or if they cannot be read. */
export function GamificationChips() {
  const pathname = usePathname();
  const s = useXpSummary(pathname);
  if (!s) return null;
  const alive = s.streak.current > 0;
  const chip = 'inline-flex items-center gap-1 rounded-full border-b-2 px-2.5 py-1 text-xs font-extrabold text-on-fun';
  return (
    <Link href="/journey" className="hidden items-center gap-1.5 sm:flex" aria-label={`Journey: ${s.xp} XP, level ${s.level}, ${s.streak.current} day streak${s.streak.atRisk ? ', at risk today' : ''}`} title={s.streak.atRisk ? 'Do one real thing today to keep your streak' : 'Open your journey'}>
      <span className={cn(chip, alive ? 'border-fun-orange-dark bg-fun-orange' : 'border-border bg-bg text-secondary')}><Flame size={13} aria-hidden />{s.streak.current}</span>
      <span className={cn(chip, 'border-fun-yellow-dark bg-fun-yellow')}><Zap size={13} aria-hidden />{s.xp} XP</span>
      <span className={cn(chip, 'border-fun-purple-dark bg-fun-purple')}>Lv {s.level}</span>
    </Link>
  );
}
