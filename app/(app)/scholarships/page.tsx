'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CircleHelp, CircleSlash, ExternalLink, Search } from 'lucide-react';
import { Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { loadOnboarding } from '@/components/onboarding/data';
import { PROGRAM_COLS } from '@/lib/programs';
import { aidProfile, buildAid, rankAid, type AidEntry, type AidKind, type AidProfile, type Fit, type RankedAid } from '@/lib/aid';
import { DESTINATION_LABEL, FUNDING_LABEL, type Onboarding } from '@/lib/onboarding';
import { cn } from '@/lib/utils';

type Loaded = { aid: AidEntry[]; ob: Onboarding; onList: string[] };
const FIT_UI: Record<Fit, { label: string; icon: React.ReactNode; cls: string }> = {
  good: { label: 'Likely fits you', icon: <BadgeCheck size={14} aria-hidden />, cls: 'border-fun-green-dark bg-fun-green/15 text-ink' },
  check: { label: 'Check if you qualify', icon: <CircleHelp size={14} aria-hidden />, cls: 'border-fun-yellow-dark bg-fun-yellow/20 text-ink' },
  no: { label: 'Probably not for you', icon: <CircleSlash size={14} aria-hidden />, cls: 'border-border bg-bg text-secondary' },
};
const KIND_LABEL: Record<AidKind, string> = { scholarship: 'Scholarship', fee_waiver: 'Fee waiver', government: 'Government' };

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn('min-h-11 rounded-full border-2 px-3 text-sm', on ? 'border-accent bg-accent/10 font-semibold text-primary' : 'bg-surface text-secondary hover:text-primary')}>
      {children}
    </button>
  );
}

export default function ScholarshipsPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countries, setCountries] = useState<string[] | null>(null);
  const [kinds, setKinds] = useState<AidKind[]>(['government', 'scholarship', 'fee_waiver']);
  const [fitsOnly, setFitsOnly] = useState(true);
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(24);

  async function load() {
    setError(null);
    try {
      const sb = supabaseBrowser();
      const [ob, rows, schools] = await Promise.all([
        loadOnboarding(sb),
        sb.from('program_requirements').select(PROGRAM_COLS),
        sb.from('schools').select('name, short_name, in_portfolio').is('deleted_at', null),
      ]);
      if (rows.error) throw new Error(rows.error.message);
      const onList = (schools.data ?? []).filter((s) => s.in_portfolio).flatMap((s) => [s.name, s.short_name].filter((n): n is string => !!n));
      setData({ aid: buildAid(rows.data), ob, onList });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load scholarships'); }
  }
  useEffect(() => { void load(); }, []);

  const profile: AidProfile | null = useMemo(() => (data ? aidProfile(data.ob, data.onList) : null), [data]);
  const picked = countries ?? profile?.countries ?? [];
  const allCountries = useMemo(() => [...new Set([...(data?.aid ?? []).map((a) => a.country).filter((c): c is string => !!c), ...(profile?.countries ?? [])])].sort(), [data, profile]);
  const list: RankedAid[] = useMemo(() => (data && profile ? rankAid(data.aid, profile, { level: profile.level, countries: picked, q, fitsOnly, kinds }) : []), [data, profile, picked, q, fitsOnly, kinds]);
  const counts = useMemo(() => ({ good: list.filter((e) => e.fit === 'good').length, check: list.filter((e) => e.fit === 'check').length }), [list]);

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!data || !profile) return <Loading label="Loading scholarships..." />;
  const ob = data.ob;
  const planBits = [ob.track === 'undergrad' ? 'Undergraduate' : 'Graduate school', ob.destinations.map((d) => DESTINATION_LABEL[d]).join(', ') || 'any country', ob.about?.funding ? `Paying with: ${FUNDING_LABEL[ob.about.funding]}` : null].filter(Boolean);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Scholarships" subtitle="Scholarships and fee waivers from the universities we researched, matched to your plan." />

      <Card className="mb-4">
        <p className="text-sm"><span className="font-semibold">Matched to your plan:</span> {planBits.join(' · ')}. <Link href="/settings#plan" className="font-semibold text-accent underline underline-offset-4">Change your plan</Link></p>
        <p className="mt-1 text-xs text-secondary">We read each scholarship&apos;s published rules and compare them with your plan. It is a helpful hint, not a promise, so always check the official page before you apply.</p>
        <p className="mt-2 text-sm"><span className="font-semibold">{counts.good}</span> likely fit you, <span className="font-semibold">{counts.check}</span> worth checking.</p>
      </Card>

      <div className="mb-4 space-y-3">
        <label className="relative block">
          <span className="sr-only">Search scholarships</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary" aria-hidden />
          <input value={q} onChange={(e) => { setQ(e.target.value); setShown(24); }} placeholder="Search by school, program or scholarship name"
            className="block min-h-11 w-full rounded-xl border-2 bg-surface pl-9 pr-3 text-sm" />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Countries">
          <Chip on={!picked.length} onClick={() => setCountries([])}>All countries</Chip>
          {allCountries.map((c) => <Chip key={c} on={picked.includes(c)} onClick={() => setCountries(picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c])}>{c}</Chip>)}
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
          {(['government', 'scholarship', 'fee_waiver'] as AidKind[]).map((k) => <Chip key={k} on={kinds.includes(k)} onClick={() => setKinds(kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k])}>{KIND_LABEL[k]}s</Chip>)}
          <Chip on={fitsOnly} onClick={() => setFitsOnly(!fitsOnly)}>Hide ones that don&apos;t fit me</Chip>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState pose="search" title={ob.track === 'undergrad' ? "We haven't added undergraduate scholarships yet" : 'No scholarships match these filters'}
          hint={ob.track === 'undergrad' ? 'We are still researching undergraduate funding. Each university page lists its own aid once we add it.' : 'Try another country or clear the search.'} />
      ) : (
        <ul className="grid gap-3">
          {list.slice(0, shown).map((e) => {
            const f = FIT_UI[e.fit];
            return (
              <li key={e.key}>
                <Card className={cn(e.fit === 'good' && 'border-fun-green-dark')}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-secondary">{KIND_LABEL[e.kind]}{e.school ? ` · ${e.school}` : ''}{e.country ? ` · ${e.country}` : ''}</p>
                      <h2 className="mt-0.5 text-base font-bold">{e.name}</h2>
                    </div>
                    <span className={cn('inline-flex items-center gap-1 rounded-full border-2 px-2.5 py-1 text-xs font-bold', f.cls)}>{f.icon}{f.label}</span>
                  </div>
                  <p className="mt-2 text-sm"><span className="font-semibold">Amount:</span> {e.amount ?? 'Not published. The school decides case by case.'}</p>
                  {e.eligibility && <p className="mt-1 text-sm text-secondary"><span className="font-semibold text-ink">Who can get it:</span> {e.eligibility}</p>}
                  {e.programs.length > 0 && <p className="mt-1 text-xs text-secondary">For: {e.programs.slice(0, 4).join(', ')}{e.programs.length > 4 ? ` and ${e.programs.length - 4} more` : ''}</p>}
                  {e.reasons.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Why">
                      {e.reasons.map((r) => <li key={r} className="rounded-full bg-bg px-2 py-0.5 text-xs text-secondary">{r}</li>)}
                    </ul>
                  )}
                  {e.sourceUrl && (
                    <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent underline underline-offset-4">
                      Official page <ExternalLink size={13} aria-hidden />
                    </a>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {list.length > shown && <div className="mt-4 text-center"><button type="button" onClick={() => setShown(shown + 24)} className="min-h-11 rounded-xl border-2 bg-surface px-4 text-sm font-semibold">Show more ({list.length - shown} left)</button></div>}
    </div>
  );
}
