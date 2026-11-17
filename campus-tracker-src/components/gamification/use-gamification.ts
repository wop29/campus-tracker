'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { useToast } from '@/components/toast';
import {
  buildQuests, computeBadges, computeStreak, detectCelebration, levelProgress, nextBadges, safeTz, totalXp, weeklySummary,
  DAILY_GOAL_DEFAULT, type Badge, type Celebration, type GamificationSettings, type QuestBoard, type Streak, type XpEvent, type LevelProgress, type WeeklySummary,
} from '@/lib/gamification';
import { computeJourney, EMPTY_JOURNEY_DATA, type Journey } from '@/lib/journey';
import { fetchGamificationSettings, fetchJourneyBundle, fetchXpEvents, saveGamificationSettings } from '@/lib/gamification-data';
import type { QuestContext } from '@/lib/gamification';

export const browserTz = () => { try { return safeTz(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch { return 'UTC'; } };

/** What this browser session has already celebrated. Survives route changes, so a failed DB write can never cause a second celebration. */
let sessionSeen: { xp: number; level: number; badges: string[] } | null = null;

export type GamificationState = {
  loading: boolean; error: string | null; reload: () => Promise<void>;
  events: XpEvent[]; xp: number; level: LevelProgress; streak: Streak; quests: QuestBoard; badges: Badge[]; nextUp: Badge[]; weekly: WeeklySummary; journey: Journey;
  settings: GamificationSettings; setDailyGoal: (n: number) => Promise<void>; tz: string;
  celebration: Celebration | null; fire: number;
};

const DEFAULT_SETTINGS: GamificationSettings = { dailyGoalXp: DAILY_GOAL_DEFAULT, lastSeenXp: 0, lastSeenLevel: 1, lastSeenBadges: [] };
const NO_CTX: QuestContext = { openRequirements: 0, openTasks: 0, essaysInProgress: 0, activeApplications: 0 };

/** Loads real XP events, journey counts and settings. With celebrate=true it also shows the honest "+N XP" celebration once per gain. */
export function useGamification(celebrate: boolean): GamificationState {
  const toast = useToast();
  const [events, setEvents] = useState<XpEvent[]>([]);
  const [journeyData, setJourneyData] = useState(EMPTY_JOURNEY_DATA);
  const [ctx, setCtx] = useState<QuestContext>(NO_CTX);
  const [settings, setSettings] = useState<GamificationSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const [fire, setFire] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const tz = useMemo(browserTz, []);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const sb = supabaseBrowser();
      const [ev, bundle, st] = await Promise.all([fetchXpEvents(sb), fetchJourneyBundle(sb), fetchGamificationSettings(sb)]);
      setEvents(ev); setJourneyData(bundle.journey); setCtx(bundle.ctx); setSettings(st); setError(null); setLoaded(true);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const now = useMemo(() => new Date(), [events]); // eslint-disable-line react-hooks/exhaustive-deps
  const xp = useMemo(() => totalXp(events), [events]);
  const level = useMemo(() => levelProgress(xp), [xp]);
  const streak = useMemo(() => computeStreak(events.map((e) => e.occurred_at), now, tz), [events, now, tz]);
  const quests = useMemo(() => buildQuests(events, ctx, now, tz, settings.dailyGoalXp), [events, ctx, now, tz, settings.dailyGoalXp]);
  const badges = useMemo(() => computeBadges(events, now, tz), [events, now, tz]);
  const nextUp = useMemo(() => nextBadges(badges, 3), [badges]);
  const weekly = useMemo(() => weeklySummary(events, now, tz), [events, now, tz]);
  const journey = useMemo(() => computeJourney(journeyData), [journeyData]);

  // Celebrate only real gains since the last time the user saw them, then persist what they have now seen.
  useEffect(() => {
    if (!celebrate || !loaded || busy.current) return;
    const unlocked = badges.filter((b) => b.unlocked).map((b) => b.id);
    const prev = sessionSeen ?? { xp: settings.lastSeenXp, level: settings.lastSeenLevel, badges: settings.lastSeenBadges };
    const cur = { xp, level: level.level, badges: unlocked };
    const c = detectCelebration(prev, cur);
    if (c.intensity === 'none' && cur.badges.length === prev.badges.length) { sessionSeen = { xp: Math.max(prev.xp, xp), level: Math.max(prev.level, level.level), badges: prev.badges }; return; }
    busy.current = true;
    sessionSeen = cur; // set first: even if the write below fails we will not celebrate this again in this session
    if (c.intensity !== 'none') {
      setCelebration(c); setFire((f) => f + 1);
      const extra = c.levelUp ? ` Level ${c.newLevel}!` : c.newBadges.length ? ` New badge${c.newBadges.length > 1 ? 's' : ''} unlocked.` : '';
      if (c.gainedXp > 0) toast(`+${c.gainedXp} XP.${extra}`); else if (extra) toast(extra.trim());
    }
    void saveGamificationSettings(supabaseBrowser(), { last_seen_xp: xp, last_seen_level: level.level, last_seen_badges: unlocked })
      .catch(() => { /* kept in sessionSeen; the next page load may celebrate again only if the write never succeeded in any session */ })
      .finally(() => { busy.current = false; });
  }, [celebrate, loaded, xp, level.level, badges, settings.lastSeenXp, settings.lastSeenLevel, settings.lastSeenBadges, toast]);

  const setDailyGoal = useCallback(async (n: number) => {
    const next = await saveGamificationSettings(supabaseBrowser(), { daily_goal_xp: n });
    setSettings((s) => ({ ...s, dailyGoalXp: next.dailyGoalXp }));
  }, []);

  return { loading, error, reload, events, xp, level, streak, quests, badges, nextUp, weekly, journey, settings, setDailyGoal, tz, celebration, fire };
}

/** Lightweight read for the header chips: XP events only. */
export function useXpSummary(refreshKey: string) {
  const [state, setState] = useState<{ xp: number; level: number; streak: Streak } | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchXpEvents(supabaseBrowser()).then((ev) => {
      if (!alive) return;
      const xp = totalXp(ev);
      setState({ xp, level: levelProgress(xp).level, streak: computeStreak(ev.map((e) => e.occurred_at), new Date(), browserTz()) });
    }).catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [refreshKey]);
  return state;
}
