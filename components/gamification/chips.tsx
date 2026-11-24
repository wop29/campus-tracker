'use client';
import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Flame, Zap } from 'lucide-react';
import { useToast } from '@/components/toast';
import { useXpSummary } from './use-gamification';
import { cn } from '@/lib/utils';

/**
 * Header chips: streak, XP and level. Real numbers only; renders nothing until they load or if they cannot be read.
 * They refresh right after an action (the 'xp:changed' event) and show a small "+15 XP" toast for the real gain.
 */
export function GamificationChips() {
  const pathname = usePathname();
  const toast = useToast();
  const onGain = useCallback((points: number) => toast(`+${points} XP`), [toast]);
  const s = useXpSummary(pathname, onGain);
  if (!s) return null;
  const alive = s.streak.current > 0;
  const chip = 'inline-flex items-center gap-1 rounded-full border-b-2 px-2.5 py-1 text-xs font-extrabold text-on-fun';
  return (
    <Link href="/journey" className="hidden min-h-[44px] items-center gap-1.5 sm:flex" aria-label={`Journey: ${s.xp} XP, level ${s.level}, ${s.streak.current} day streak${s.streak.atRisk ? ', at risk today' : ''}`} title={s.streak.atRisk ? 'Do one real thing today to keep your streak' : 'Open your journey'}>
      <span className={cn(chip, alive ? 'border-fun-orange-dark bg-fun-orange' : 'border-border bg-bg text-secondary')}><Flame size={13} aria-hidden />{s.streak.current}</span>
      <span className={cn(chip, 'border-fun-yellow-dark bg-fun-yellow')}><Zap size={13} aria-hidden /><span className="tabular-nums">{s.xp}</span> XP</span>
      <span className={cn(chip, 'border-fun-purple-dark bg-fun-purple')}>Lv {s.level}</span>
    </Link>
  );
}
