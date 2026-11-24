'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ExternalLink, Plus, Search } from 'lucide-react';
import { Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, Pill } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { loadSettings } from '@/components/onboarding/data';
import { parseOnboarding, type Onboarding } from '@/lib/onboarding';
import { DEGREE_LABEL, PROGRAM_COLS } from '@/lib/programs';
import {
  FIELDS, buildCatalogue, catalogueCountries, chipsFor, countriesFromDestinations, fieldsFromOnboarding, filterCatalogue, schoolKey,
  type CatalogueProgram, type ExistingSchool, type FieldKey, type Level, type University,
} from '@/lib/catalogue';
import { cn } from '@/lib/utils';
import { CatalogueNav } from './catalogue-nav';
import { CatalogueAddModal } from './catalogue-add';
import { SchoolFormModal } from './school-form';

const PAGE = 24;
type Loaded = { unis: University[]; ob: Onboarding; fields: FieldKey[]; mine: ExistingSchool[]; started: Set<string> };

/** A toggle chip (real button with aria-pressed) for the country and field filters. */
function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border-2 px-3 text-sm font-bold transition-colors', on ? 'border-accent bg-accent/10 text-primary' : 'border-line bg-surface text-secondary hover:text-ink')}>
      {children}
    </button>
  );
}

export function CatalogueView() {
  const router = useRouter();
  const [st, setSt] = useState<Loaded | null>(null); const [error, setError] = useState<string | null>(null);
  const [track, setTrack] = useState<Level>('grad'); const [countries, setCountries] = useState<string[]>([]); const [fields, setFields] = useState<FieldKey[]>([]);
  const [q, setQ] = useState(''); const [limit, setLimit] = useState(PAGE); const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false); const [adding, setAdding] = useState(false);

  const load = useCallback(async (first: boolean) => {
    try {
      const sb = supabaseBrowser();
      const [settings, rows, mine, apps] = await Promise.all([
        loadSettings(sb),
        sb.from('program_requirements').select(PROGRAM_COLS).order('school_name'),
        sb.from('schools').select('id, name, deleted_at'),
        sb.from('applications').select('program_requirement_id').is('deleted_at', null).not('program_requirement_id', 'is', null),
      ]);
      for (const r of [rows, mine, apps]) if (r.error) throw new Error(r.error.message);
      const ob = parseOnboarding(settings);
      const loaded: Loaded = {
        unis: buildCatalogue(rows.data), ob, fields: fieldsFromOnboarding(settings), mine: (mine.data ?? []) as ExistingSchool[],
        started: new Set(((apps.data ?? []) as { program_requirement_id: string }[]).map((a) => a.program_requirement_id)),
      };
      setSt(loaded); setError(null);
      if (first) { setTrack(ob.track); setCountries(countriesFromDestinations(ob.destinations)); setFields(loaded.fields); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(true); }, [load]);

  const filtered = useMemo(() => (st ? filterCatalogue(st.unis, { track, countries, fields, q, preferred: st.ob.program }) : []), [st, track, countries, fields, q]);
  const countryOptions = useMemo(() => (st ? catalogueCountries(st.unis.filter((u) => u.programs.some((p) => p.level === track)), countriesFromDestinations(st.ob.destinations)) : []), [st, track]);
  const onList = useMemo(() => new Map((st?.mine ?? []).filter((s) => !s.deleted_at).map((s) => [schoolKey(s.name), s.id])), [st]);
  const byId = useMemo(() => new Map((st?.unis ?? []).flatMap((u) => u.programs.map((p) => [p.program.id, p] as const))), [st]);
  const picks = useMemo(() => [...sel].map((id) => byId.get(id)).filter((p): p is CatalogueProgram => !!p), [sel, byId]);
  const today = useMemo(() => new Date(), []);

  useEffect(() => { setLimit(PAGE); }, [track, countries, fields, q]);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const flip = (ids: string[], on: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n; });
  const filtersOn = countries.length > 0 || fields.length > 0 || q.trim() !== '';

  const addForm = <SchoolFormModal open={adding} onClose={() => setAdding(false)} onSaved={(id) => router.push(`/schools/${id}`)} />;
  if (error) return <div><Header onAdd={() => setAdding(true)} /><ErrorBox message={error} onRetry={() => void load(false)} />{addForm}</div>;
  if (!st) return <div><Header onAdd={() => setAdding(true)} /><Loading />{addForm}</div>;

  const shown = filtered.slice(0, limit);
  return (
    <div className="pb-24">
      <Header onAdd={() => setAdding(true)} />
      <Card className="mb-4 space-y-3">
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary" aria-hidden />
          <Input type="search" aria-label="Search universities, cities or programs" placeholder="Search a university, city or program" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 pl-9" />
        </div>
        <fieldset>
          <legend className="mb-1 text-xs font-bold text-secondary">Level</legend>
          <div className="flex flex-wrap gap-2">
            <Toggle on={track === 'grad'} onClick={() => setTrack('grad')}>Graduate (MBA, master&apos;s)</Toggle>
            <Toggle on={track === 'undergrad'} onClick={() => setTrack('undergrad')}>Undergraduate</Toggle>
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs font-bold text-secondary">Countries {countries.length === 0 && <span className="font-medium">(all)</span>}</legend>
          <div className="flex flex-wrap gap-2">{countryOptions.map((c) => <Toggle key={c} on={countries.includes(c)} onClick={() => setCountries((l) => toggle(l, c))}>{c}</Toggle>)}</div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs font-bold text-secondary">Field of study {fields.length === 0 && <span className="font-medium">(all)</span>}</legend>
          <div className="flex flex-wrap gap-2">{FIELDS.map((f) => <Toggle key={f.key} on={fields.includes(f.key)} onClick={() => setFields((l) => toggle(l, f.key))}>{f.label}</Toggle>)}</div>
          {track === 'undergrad' && <p className="mt-1 text-xs text-secondary">Undergraduate entries cover first-year admission for every major, so they show for any field.</p>}
        </fieldset>
        {filtersOn && <button type="button" onClick={() => { setCountries([]); setFields([]); setQ(''); }} className="min-h-11 text-sm font-bold text-accent underline">Clear filters</button>}
      </Card>

      {filtered.length === 0 ? (
        <EmptyState pose="search" title="We haven't researched universities for this filter yet"
          hint={filtersOn ? 'Try another country or field, or add a university you like. You can still track it here.' : 'More universities are on the way. You can add a university you like in the meantime.'}
          action={<div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setAdding(true)} className="min-h-11"><Plus size={14} aria-hidden /> Add a university yourself</Button>
            {filtersOn && <Button variant="secondary" onClick={() => { setCountries([]); setFields([]); setQ(''); }} className="min-h-11">Clear filters</Button>}
          </div>} />
      ) : (
        <>
          <p className="mb-2 text-sm text-secondary" role="status">{filtered.length} {filtered.length === 1 ? 'university' : 'universities'} match. Tick the programs you like, then add them to your list in one go.</p>
          <ul className="grid gap-3 lg:grid-cols-2">
            {shown.map((u, ui) => {
              const ids = u.programs.map((p) => p.program.id); const count = ids.filter((id) => sel.has(id)).length;
              const listed = onList.get(schoolKey(u.name));
              return (
                <li key={u.name}>
                  <Card className={cn('h-full space-y-3', count > 0 && 'border-accent')}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" id={`uni-${ui}`} aria-label={`Select every listed program at ${u.name}`} checked={count === ids.length}
                        ref={(el) => { if (el) el.indeterminate = count > 0 && count < ids.length; }} onChange={(e) => flip(ids, e.target.checked)}
                        className="mt-1 size-6 shrink-0 accent-[var(--color-accent)]" />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={`uni-${ui}`} className="block cursor-pointer text-base font-extrabold text-ink">{u.name}</label>
                        {u.fullName && u.fullName !== u.name && <p className="text-xs text-secondary">{u.fullName}</p>}
                        <p className="text-sm text-secondary">{[u.city, u.country].filter(Boolean).join(', ') || 'Location not listed'}</p>
                      </div>
                      {listed && <Link href={`/schools/${listed}`} className="inline-flex min-h-11 shrink-0 items-center text-xs font-bold text-accent hover:underline">On your list</Link>}
                    </div>
                    <ul className="space-y-2">
                      {u.programs.map((p) => {
                        const id = p.program.id; const chips = chipsFor(p, today);
                        return (
                          <li key={id} className="rounded-xl border-2 bg-bg/60 p-2">
                            <label className="flex min-h-11 cursor-pointer items-start gap-3">
                              <input type="checkbox" checked={sel.has(id)} onChange={(e) => flip([id], e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-bold text-ink">{p.program.program_name}</span>
                                <span className="block text-xs text-secondary">
                                  {[p.level === 'undergrad' ? 'Undergraduate' : DEGREE_LABEL[p.program.degree_type], p.program.duration, p.program.intake].filter(Boolean).join(' · ')}
                                  {st.started.has(id) && ' · Application started'}
                                </span>
                              </span>
                            </label>
                            {chips.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{chips.map((c) => <Pill key={c.key} tone={c.tone}>{c.text}</Pill>)}</div>}
                            {p.noVisa && <p className="mt-2 flex items-start gap-1.5 text-xs font-bold text-warning-ink"><AlertTriangle size={14} className="mt-px shrink-0" aria-hidden /> No student visa: this program does not sponsor a student visa, so check before you apply from Indonesia.</p>}
                            {p.program.program_url && <a href={p.program.program_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1 text-xs font-bold text-accent hover:underline">Official page <ExternalLink size={11} aria-hidden /><span className="sr-only">(opens in a new tab)</span></a>}
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                </li>
              );
            })}
          </ul>
          {filtered.length > limit && (
            <div className="mt-4 flex justify-center"><Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)} className="min-h-11">Show more ({filtered.length - limit} more)</Button></div>
          )}
        </>
      )}

      {sel.size > 0 && (
        <div className="sticky bottom-3 z-20 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-accent bg-surface p-3 shadow-lg">
          <p className="text-sm font-bold text-ink">{sel.size} {sel.size === 1 ? 'program' : 'programs'} picked at {new Set(picks.map((p) => p.school)).size} {new Set(picks.map((p) => p.school)).size === 1 ? 'university' : 'universities'}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setSel(new Set())} className="min-h-11">Clear</Button>
            <Button onClick={() => setConfirming(true)} className="min-h-11">Add to my list ({sel.size})</Button>
          </div>
        </div>
      )}

      <CatalogueAddModal open={confirming} onClose={() => setConfirming(false)} picks={picks} unis={st.unis} mine={st.mine} started={st.started} intake={st.ob.intake}
        onDone={() => { setSel(new Set()); void load(false); }} />
      {addForm}
    </div>
  );
}

function Header({ onAdd }: { onAdd: () => void }) {
  return (
    <>
      <PageHeader title="Find universities" subtitle="Universities we have researched for you, from their official pages. Pick the ones you like." actions={<Button variant="secondary" onClick={onAdd} className="min-h-11"><Plus size={14} aria-hidden /> Add your own</Button>} />
      <CatalogueNav active="find" />
    </>
  );
}
