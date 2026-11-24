'use client';
import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, School } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { loadOnboarding, saveOnboarding } from '@/components/onboarding/data';
import {
  STATUS_FOR_TRACK, STATUS_LABEL, parseAbout, FUNDINGS, FUNDING_LABEL, LPDP_STATUSES, LPDP_LABEL, ENGLISH_STATUSES, ENGLISH_LABEL, WORRIES, WORRY_LABEL, DESTINATIONS, DESTINATION_LABEL, FIELDS, FIELD_LABEL, PROGRAMS, PROGRAM_LABEL, STAGES,
  intakeOptions, type About, type Destination, type Field, type Onboarding, type Program, type Stage, type Track,
} from '@/lib/onboarding';
import { cn } from '@/lib/utils';

const STAGE_LABEL: Record<Stage, string> = {
  exploring: 'Just exploring', shortlisting: 'Picking schools', applying: 'Applying now', submitted: 'Waiting for results',
};
const NOT_SURE = 'Not sure yet';

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border-2 px-3 text-sm', on ? 'border-accent bg-accent/10 font-semibold text-primary' : 'bg-surface text-secondary hover:text-primary')}>
      {children}
    </button>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-4">
      <legend className="text-sm font-semibold">{label}</legend>
      {hint && <p className="text-xs text-secondary">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/** "Your plan": change track (grad or undergrad), programs, countries, field, intake and stage at any time. */
export function PlanSection() {
  const toast = useToast();
  const [saved, setSaved] = useState<Onboarding | null>(null);
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadOnboarding(supabaseBrowser()).then((o) => { setSaved(o); setOb(o); }).catch(() => toast('Could not load your plan', 'err'));
  }, [toast]);

  const intakes = useMemo(() => (ob ? intakeOptions(ob.destinations, new Date()) : []), [ob]);
  if (!ob || !saved) return <Card className="mb-4"><h2 className="text-base font-semibold">Your plan</h2><p className="mt-2 text-sm text-secondary">Loading...</p></Card>;

  const set = (patch: Partial<Onboarding>) => setOb({ ...ob, ...patch });
  // Keep raw text while typing; parseAbout trims on save.
  const setAbout = (patch: About) => setOb({ ...ob, about: { ...ob.about, ...patch } });
  const programs = ob.programs ?? (ob.program ? [ob.program] : []);
  const setTrack = (track: Track) => set(track === 'undergrad'
    ? { track, program: undefined, programs: undefined }
    : { track, programs: programs.length ? programs : ['mba'], program: programs[0] ?? 'mba' });
  const setPrograms = (p: Program[]) => set({ programs: p.length ? p : undefined, program: p[0] });
  const dirty = JSON.stringify(ob) !== JSON.stringify(saved);
  const intakeChoices = ob.intake && !intakes.includes(ob.intake) ? [ob.intake, ...intakes] : intakes;

  async function save() {
    if (!ob || saving) return;
    if (ob.track === 'grad' && !programs.length) { toast('Pick at least one program', 'err'); return; }
    setSaving(true);
    try {
      const about = parseAbout(ob.about);
      const stored = await saveOnboarding(supabaseBrowser(), { ...ob, about, done: true });
      const switched = stored.track !== saved?.track;
      setSaved(stored); setOb(stored);
      toast(switched ? `Switched to ${stored.track === 'undergrad' ? 'undergraduate' : 'graduate'} mode. Your pages now follow this plan.` : 'Your plan is saved');
      if (switched && typeof window !== 'undefined') window.dispatchEvent(new Event('xp:changed'));
    } catch (e) { toast((e as Error).message, 'err'); } finally { setSaving(false); }
  }

  return (
    <Card className="mb-4">
      <h2 className="text-base font-semibold">Your plan</h2>
      <p className="mt-0.5 text-xs text-secondary">Change this any time. Find universities, your checklists, Journey and Profile all follow it. Nothing you already added is deleted.</p>

      <Row label="I'm applying for">
        <button type="button" aria-pressed={ob.track === 'undergrad'} onClick={() => setTrack('undergrad')}
          className={cn('flex min-h-11 items-center gap-2 rounded-2xl border-2 px-4 py-2 text-sm', ob.track === 'undergrad' ? 'border-accent bg-accent/10 font-semibold' : 'bg-surface text-secondary')}>
          <School size={16} aria-hidden /> Undergraduate (S1)
        </button>
        <button type="button" aria-pressed={ob.track === 'grad'} onClick={() => setTrack('grad')}
          className={cn('flex min-h-11 items-center gap-2 rounded-2xl border-2 px-4 py-2 text-sm', ob.track === 'grad' ? 'border-accent bg-accent/10 font-semibold' : 'bg-surface text-secondary')}>
          <GraduationCap size={16} aria-hidden /> Graduate school (S2/S3)
        </button>
      </Row>

      <Row label="What are you doing now?">
        {STATUS_FOR_TRACK[ob.track].map((st) => <Chip key={st} on={ob.about?.status === st} onClick={() => setAbout({ status: ob.about?.status === st ? undefined : st })}>{STATUS_LABEL[st]}</Chip>)}
      </Row>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">{ob.track === 'undergrad' ? 'Your school' : 'Your university (current or most recent)'}
          <input value={ob.about?.school ?? ''} onChange={(e) => setAbout({ school: e.target.value })} maxLength={120} placeholder={ob.track === 'undergrad' ? 'e.g. SMAN 3 Bandung' : 'e.g. Institut Teknologi Bandung'}
            className="mt-1 block min-h-11 w-full rounded-xl border-2 bg-bg px-3 text-sm font-normal" />
        </label>
        <label className="text-sm font-semibold">Where do you live now?
          <input value={ob.about?.city ?? ''} onChange={(e) => setAbout({ city: e.target.value })} maxLength={120} placeholder="e.g. Jakarta, Indonesia"
            className="mt-1 block min-h-11 w-full rounded-xl border-2 bg-bg px-3 text-sm font-normal" />
        </label>
      </div>

      <Row label="How will you pay for your studies?">
        {FUNDINGS.map((f) => <Chip key={f} on={ob.about?.funding === f} onClick={() => setAbout({ funding: ob.about?.funding === f ? undefined : f })}>{FUNDING_LABEL[f]}</Chip>)}
      </Row>
      {ob.about?.funding === 'lpdp' && (
        <Row label="Where are you with LPDP?">
          {LPDP_STATUSES.map((l) => <Chip key={l} on={ob.about?.lpdp === l} onClick={() => setAbout({ lpdp: ob.about?.lpdp === l ? undefined : l })}>{LPDP_LABEL[l]}</Chip>)}
        </Row>
      )}
      <Row label="Have you taken an English test?">
        {ENGLISH_STATUSES.map((x) => <Chip key={x} on={ob.about?.english === x} onClick={() => setAbout({ english: ob.about?.english === x ? undefined : x })}>{ENGLISH_LABEL[x]}</Chip>)}
      </Row>
      <Row label="What worries you most?">
        {WORRIES.map((w) => <Chip key={w} on={ob.about?.worry === w} onClick={() => setAbout({ worry: ob.about?.worry === w ? undefined : w })}>{WORRY_LABEL[w]}</Chip>)}
      </Row>

      {ob.track === 'grad' && (
        <Row label="Programs" hint="Pick one or more. The first one is your main choice.">
          {PROGRAMS.map((p) => <Chip key={p} on={programs.includes(p)} onClick={() => setPrograms(toggle(programs, p))}>{PROGRAM_LABEL[p]}{programs[0] === p && programs.length > 1 ? ' (main)' : ''}</Chip>)}
        </Row>
      )}

      <Row label="Where do you want to study?">
        {DESTINATIONS.map((d) => <Chip key={d} on={ob.destinations.includes(d)} onClick={() => set({ destinations: toggle<Destination>(ob.destinations, d) })}>{DESTINATION_LABEL[d]}</Chip>)}
      </Row>

      <Row label="What do you want to study?" hint="Optional. Used to filter Find universities.">
        {FIELDS.map((f) => {
          const fields = ob.fields ?? [];
          return <Chip key={f} on={fields.includes(f)} onClick={() => { const next = toggle<Field>(fields, f); set({ fields: next.length ? next : undefined }); }}>{FIELD_LABEL[f]}</Chip>;
        })}
      </Row>

      <Row label="When do you want to start?">
        {[...intakeChoices, NOT_SURE].map((i) => <Chip key={i} on={(ob.intake ?? NOT_SURE) === i} onClick={() => set({ intake: i === NOT_SURE ? undefined : i })}>{i}</Chip>)}
      </Row>

      <Row label="Where are you right now?">
        {STAGES.map((s) => <Chip key={s} on={ob.stage === s} onClick={() => set({ stage: s })}>{STAGE_LABEL[s]}</Chip>)}
      </Row>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? 'Saving...' : 'Save my plan'}</Button>
        {dirty && <Button variant="secondary" onClick={() => setOb(saved)}>Undo changes</Button>}
      </div>
    </Card>
  );
}
