'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, BookOpen, Check, Compass, GraduationCap, ListChecks, PartyPopper, School, Send, Sparkles } from 'lucide-react';
import { Button, ErrorBox } from '@/components/ui';
import { Mascot, type MascotPose } from '@/components/mascot';
import { Confetti } from '@/components/confetti';
import { supabaseBrowser } from '@/lib/supabase/client';
import { THEMES, DEFAULT_THEME, applyTheme, isThemeId, readThemeCookie, writeThemeCookie, type ThemeId } from '@/components/theme/themes';
import {
  DEFAULT_ONBOARDING, DESTINATIONS, DESTINATION_LABEL, REMINDER_HOURS, browserTimeZone, nextIntakes, parseOnboarding,
  type Destination, type Onboarding, type Program, type Stage, type Track,
} from '@/lib/onboarding';
import { cn } from '@/lib/utils';
import { OptionCard, onGroupKeyDown } from './option-card';
import { loadSettings, saveOnboarding } from './data';

const STEPS = 4;
const MASCOT_LINES: { pose: MascotPose; line: string }[] = [
  { pose: 'wave', line: 'Hi, I am Mochi! Four quick taps and you are set. No essays today, promise.' },
  { pose: 'search', line: 'Dream big. You can pick more than one country.' },
  { pose: 'thinking', line: 'Joining late is fine, we will start you where you are.' },
  { pose: 'cheer', line: 'Last one! Make this space feel like yours.' },
];
const PROGRAM_OPTIONS: { id: Program; label: string }[] = [{ id: 'mba', label: 'MBA' }, { id: 'masters', label: "Master's" }, { id: 'phd', label: 'PhD' }];
const DEST_SHORT: Record<Destination, string> = { us: 'US', canada: 'CA', australia: 'AU', uk: 'UK' };
const STAGE_OPTIONS: { id: Stage; title: string; subtitle: string; icon: React.ReactNode }[] = [
  { id: 'exploring', title: 'Just exploring', subtitle: 'Still figuring out if and where to apply.', icon: <Compass size={24} /> },
  { id: 'shortlisting', title: 'Picking schools', subtitle: 'Building a list of places I like.', icon: <ListChecks size={24} /> },
  { id: 'applying', title: 'Already applying', subtitle: 'Working on applications right now.', icon: <BookOpen size={24} /> },
  { id: 'submitted', title: 'Already submitted', subtitle: 'At least one application is in.', icon: <Send size={24} /> },
];
const HOUR_OPTIONS: { hour: (typeof REMINDER_HOURS)[number]; label: string }[] = [{ hour: 8, label: 'Morning (8:00)' }, { hour: 12, label: 'Lunch (12:00)' }, { hour: 19, label: 'Evening (19:00)' }];
const NOT_SURE = 'not-sure';

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [track, setTrack] = useState<Track | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [intake, setIntake] = useState<string>(NOT_SURE);
  const [stage, setStage] = useState<Stage | null>(null);
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [email, setEmail] = useState(true);
  const [hour, setHour] = useState<number>(DEFAULT_ONBOARDING.reminders.hourLocal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fire, setFire] = useState(0);
  const [finished, setFinished] = useState(false);
  const initialTheme = useRef<ThemeId>(DEFAULT_THEME);
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const intakes = useMemo(() => nextIntakes(new Date()), []);

  // Prefill from anything saved before (for example when the user comes back to /welcome).
  useEffect(() => {
    const t = readThemeCookie() ?? DEFAULT_THEME;
    setTheme(t); initialTheme.current = t;
    let cancelled = false;
    void (async () => {
      try {
        const s = await loadSettings(supabaseBrowser());
        if (cancelled || !s) return;
        if (isThemeId(s.theme)) { setTheme(s.theme); initialTheme.current = s.theme; }
        if (!s.onboarding) return;
        const ob = parseOnboarding(s);
        setTrack(ob.track); setProgram(ob.program ?? null); setDestinations(ob.destinations); setStage(ob.stage);
        if (ob.intake) setIntake(ob.intake);
        setEmail(ob.reminders.email); setHour(ob.reminders.hourLocal);
      } catch { /* start fresh */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Move focus to the new question so keyboard and screen reader users land in the right place.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [step]);

  const valid = [
    track === 'undergrad' || (track === 'grad' && program !== null),
    destinations.length > 0,
    stage !== null,
    true,
  ][step];

  function pickTheme(id: ThemeId) { setTheme(id); applyTheme(id); }
  function toggleDest(d: Destination) { setDestinations((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d])); }

  async function save(ob: Onboarding, extra: Record<string, unknown>) {
    setSaving(true); setError(null);
    try {
      await saveOnboarding(supabaseBrowser(), ob, extra);
      if (isThemeId(extra.theme)) writeThemeCookie(extra.theme);
      return true;
    } catch (e) {
      setError(`We could not save that. ${e instanceof Error ? e.message : ''} Please try again.`.trim());
      return false;
    } finally { setSaving(false); }
  }

  async function finish() {
    const ob: Onboarding = {
      done: true, track: track ?? 'grad', ...(track === 'grad' && program ? { program } : {}), destinations,
      ...(intake !== NOT_SURE ? { intake } : {}), stage: stage ?? 'exploring',
      reminders: { email, hourLocal: hour }, timezone: browserTimeZone(),
    };
    if (!(await save(ob, { theme }))) return;
    setFinished(true); setFire((f) => f + 1);
    window.setTimeout(() => router.push('/journey'), 1400);
  }

  async function skip() {
    applyTheme(initialTheme.current); setTheme(initialTheme.current);
    const ob: Onboarding = { ...DEFAULT_ONBOARDING, reminders: { ...DEFAULT_ONBOARDING.reminders }, done: true, timezone: browserTimeZone() };
    if (await save(ob, {})) router.push('/journey');
  }

  function next() { if (!valid || saving) return; if (step < STEPS - 1) setStep(step + 1); else void finish(); }

  if (finished) {
    return (
      <div className="flex flex-col items-center text-center" role="status">
        <Confetti fire={fire} intense />
        <Mascot pose="party" size={140} priority />
        <h1 className="mt-4 text-3xl font-extrabold">You are all set!</h1>
        <p className="mt-2 max-w-sm text-secondary">Your path is ready. It is short, and every step is one small action. Taking you there now...</p>
      </div>
    );
  }

  const m = MASCOT_LINES[step];
  const radioTab = <T,>(value: T, selected: T | null, first: T) => (selected === null ? value === first : value === selected);

  return (
    <div className="w-full">
      <div className="mb-5 flex items-center justify-between gap-3">
        <ol className="flex items-center gap-2" aria-label={`Step ${step + 1} of ${STEPS}`}>
          {Array.from({ length: STEPS }, (_, i) => (
            <li key={i} className={cn('h-3 rounded-full transition-all', i === step ? 'w-8 bg-fun-green' : i < step ? 'w-3 bg-fun-green-dark' : 'w-3 bg-border')} aria-current={i === step ? 'step' : undefined}>
              <span className="sr-only">Step {i + 1}{i < step ? ', done' : i === step ? ', current' : ''}</span>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => void skip()} disabled={saving} className="rounded-xl px-2 py-1 text-sm font-bold text-secondary underline-offset-4 hover:text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">Skip for now</button>
      </div>

      {step === 0 && <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-fun-yellow/30 px-3 py-1 text-xs font-extrabold"><Sparkles size={14} aria-hidden />Takes about 1 minute</p>}

      <div className="mb-5 flex items-end gap-3">
        <Mascot key={m.pose} pose={m.pose} size={72} decorative priority className="pop-in" />
        <p className="relative rounded-2xl border-2 bg-surface px-4 py-3 text-sm font-bold shadow-[0_3px_0_var(--color-border)]" aria-live="polite">{m.line}</p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); next(); }}>
        {step === 0 && (
          <fieldset>
            <legend className="sr-only">What are you applying for?</legend>
            <h1 ref={heading} tabIndex={-1} className="mb-4 text-2xl font-extrabold outline-none sm:text-3xl">What are you applying for?</h1>
            <div role="radiogroup" aria-label="Level of study" className="grid gap-3" onKeyDown={(e) => onGroupKeyDown(e, true)}>
              <OptionCard selected={track === 'grad'} tabbable={radioTab<Track>('grad', track, 'grad')} onSelect={() => setTrack('grad')} title="Grad school" subtitle="MBA, Master's or PhD" icon={<GraduationCap size={24} />} />
              <OptionCard selected={track === 'undergrad'} tabbable={radioTab<Track>('undergrad', track, 'grad')} onSelect={() => setTrack('undergrad')} title="Undergraduate" subtitle="A bachelor's degree" icon={<School size={24} />} />
            </div>
            {track === 'grad' && (
              <div className="mt-5">
                <p id="program-label" className="mb-2 text-sm font-extrabold">Which program?</p>
                <div role="radiogroup" aria-labelledby="program-label" className="flex flex-wrap gap-2" onKeyDown={(e) => onGroupKeyDown(e, true)}>
                  {PROGRAM_OPTIONS.map((p) => (
                    <OptionCard key={p.id} size="chip" selected={program === p.id} tabbable={radioTab<Program>(p.id, program, 'mba')} onSelect={() => setProgram(p.id)} title={p.label} />
                  ))}
                </div>
              </div>
            )}
          </fieldset>
        )}

        {step === 1 && (
          <fieldset>
            <legend className="sr-only">Where do you want to study?</legend>
            <h1 ref={heading} tabIndex={-1} className="mb-1 text-2xl font-extrabold outline-none sm:text-3xl">Where do you want to study?</h1>
            <p className="mb-4 text-sm text-secondary">Pick all that apply.</p>
            <div role="group" aria-label="Countries" className="grid gap-3 sm:grid-cols-2" onKeyDown={(e) => onGroupKeyDown(e, false)}>
              {DESTINATIONS.map((d) => (
                <OptionCard key={d} multi selected={destinations.includes(d)} onSelect={() => toggleDest(d)} title={DESTINATION_LABEL[d]} icon={<span className="text-sm font-extrabold">{DEST_SHORT[d]}</span>} />
              ))}
            </div>
            <p id="intake-label" className="mb-2 mt-5 text-sm font-extrabold">When do you want to start?</p>
            <div role="radiogroup" aria-labelledby="intake-label" className="flex flex-wrap gap-2" onKeyDown={(e) => onGroupKeyDown(e, true)}>
              {[...intakes, NOT_SURE].map((i) => (
                <OptionCard key={i} size="chip" selected={intake === i} tabbable={intake === i} onSelect={() => setIntake(i)} title={i === NOT_SURE ? 'Not sure yet' : i} />
              ))}
              {intake !== NOT_SURE && !intakes.includes(intake) && (
                <OptionCard size="chip" selected tabbable onSelect={() => undefined} title={intake} />
              )}
            </div>
          </fieldset>
        )}

        {step === 2 && (
          <fieldset>
            <legend className="sr-only">Where are you right now?</legend>
            <h1 ref={heading} tabIndex={-1} className="mb-1 text-2xl font-extrabold outline-none sm:text-3xl">Where are you right now?</h1>
            <p className="mb-4 text-sm text-secondary">Joining late is fine, we will start you where you are.</p>
            <div role="radiogroup" aria-label="Your stage" className="grid gap-3" onKeyDown={(e) => onGroupKeyDown(e, true)}>
              {STAGE_OPTIONS.map((s) => (
                <OptionCard key={s.id} selected={stage === s.id} tabbable={radioTab<Stage>(s.id, stage, 'exploring')} onSelect={() => setStage(s.id)} title={s.title} subtitle={s.subtitle} icon={s.icon} />
              ))}
            </div>
          </fieldset>
        )}

        {step === 3 && (
          <fieldset>
            <legend className="sr-only">Make it yours</legend>
            <h1 ref={heading} tabIndex={-1} className="mb-4 text-2xl font-extrabold outline-none sm:text-3xl">Make it yours</h1>
            <p id="theme-label" className="mb-2 text-sm font-extrabold">Pick a colour theme</p>
            <div role="radiogroup" aria-labelledby="theme-label" className="grid grid-cols-2 gap-3" onKeyDown={(e) => onGroupKeyDown(e, true)}>
              {THEMES.map((t) => {
                const selected = t.id === theme;
                return (
                  <button key={t.id} type="button" data-option role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1} onClick={() => pickTheme(t.id)} data-theme={t.id}
                    className={cn('btn-3d rounded-2xl border-2 border-b-4 bg-bg p-3 text-left text-ink transition active:translate-y-[2px] active:border-b-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', selected ? 'border-fun-green-dark' : 'border-border hover:border-line')}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold">{t.label}</span>
                      {selected && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-fun-green text-on-fun" aria-hidden><Check size={12} strokeWidth={3} /></span>}
                    </span>
                    <span className="mt-2 flex items-center gap-1" aria-hidden>
                      {['green', 'blue', 'orange', 'pink', 'yellow', 'purple'].map((c) => <span key={c} className="h-4 w-4 rounded-full border-b-2" style={{ background: `var(--color-fun-${c})`, borderColor: `var(--color-fun-${c}-dark)` }} />)}
                    </span>
                    <span className="mt-2 block rounded-xl border-2 bg-surface p-2" aria-hidden>
                      <span className="block h-1.5 w-2/3 rounded-full bg-ink/80" />
                      <span className="mt-1.5 inline-block rounded-lg border-b-2 border-fun-green-dark bg-fun-green px-2 py-0.5 text-[10px] font-extrabold text-on-fun">Go</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 rounded-2xl border-2 bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <span id="nudge-label" className="text-sm font-extrabold">Send me a short daily email nudge</span>
                <button type="button" role="switch" aria-checked={email} aria-labelledby="nudge-label" onClick={() => setEmail((v) => !v)}
                  className={cn('relative h-8 w-14 shrink-0 rounded-full border-2 border-b-4 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', email ? 'border-fun-green-dark bg-fun-green' : 'border-border bg-bg')}>
                  <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', email ? 'left-7' : 'left-1')} aria-hidden />
                </button>
              </div>
              <p className="mt-1 text-xs text-secondary">One small next step, once a day. Turn it off anytime in Settings.</p>
              {email && (
                <div role="radiogroup" aria-label="Nudge time" className="mt-3 flex flex-wrap gap-2" onKeyDown={(e) => onGroupKeyDown(e, true)}>
                  {HOUR_OPTIONS.map((h) => (
                    <OptionCard key={h.hour} size="chip" selected={hour === h.hour} tabbable={hour === h.hour || (!HOUR_OPTIONS.some((x) => x.hour === hour) && h.hour === 19)} onSelect={() => setHour(h.hour)} title={h.label} />
                  ))}
                </div>
              )}
            </div>
          </fieldset>
        )}

        {error && <div className="mt-4"><ErrorBox message={error} /></div>}

        <div className="mt-6 flex items-center justify-between gap-3">
          {step > 0
            ? <Button type="button" variant="secondary" onClick={() => setStep(step - 1)} disabled={saving}><ArrowLeft size={16} aria-hidden />Back</Button>
            : <span />}
          <Button type="submit" disabled={!valid || saving} className="min-w-[140px] px-6 py-3 text-base">
            {step < STEPS - 1 ? <>Continue<ArrowRight size={16} aria-hidden /></> : saving ? 'Saving...' : <>Let&apos;s go<PartyPopper size={16} aria-hidden /></>}
          </Button>
        </div>
      </form>
    </div>
  );
}
