'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Badge, Card, EmptyState, ErrorBox, Loading, PageHeader } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { STAGE_LABEL, TIER_LABEL, type Stage } from '@/lib/constants';
import { PROGRAM_SEARCH_COLS, searchAll, type SearchApp, type SearchEssay, type SearchProgram, type SearchSchool } from '@/lib/search';
import { titleCase } from '@/lib/utils';
import { ESSAY_STATUS_LABEL, type EssayStatus } from '@/lib/essays';

type Mine = { schools: SearchSchool[]; applications: SearchApp[]; essays: SearchEssay[] };

// Kept for the whole browser session so a second search (or coming back to this page) shows results at once.
// The student's own rows are refreshed quietly in the background; the program list rarely changes.
const MINE_FRESH_MS = 30_000;
const PROGRAMS_FRESH_MS = 30 * 60_000;
let mineCache: { at: number; data: Mine } | null = null;
let programsCache: { at: number; data: SearchProgram[] } | null = null;

async function fetchMine(): Promise<Mine> {
  const sb = supabaseBrowser();
  const [s, a, e] = await Promise.all([
    sb.from('schools').select('id,name,short_name,country,location,tier,in_portfolio,notes').is('deleted_at', null),
    sb.from('applications').select('id,school_id,program,intake,round,stage,notes').is('deleted_at', null),
    sb.from('essays').select('id,title,status,school_id,application_id').is('deleted_at', null),
  ]);
  const err = s.error ?? a.error ?? e.error;
  if (err) throw new Error(err.message);
  const data = { schools: (s.data ?? []) as SearchSchool[], applications: (a.data ?? []) as SearchApp[], essays: (e.data ?? []) as SearchEssay[] };
  mineCache = { at: Date.now(), data };
  return data;
}
/** Researched programs. A missing table or a network error gives an empty list: search still works for the student's own data. */
async function fetchPrograms(): Promise<SearchProgram[]> {
  const { data, error } = await supabaseBrowser().from('program_requirements').select(PROGRAM_SEARCH_COLS).order('school_name').limit(2000);
  const rows = error ? [] : ((data ?? []) as unknown as SearchProgram[]);
  if (!error) programsCache = { at: Date.now(), data: rows };
  return rows;
}

/** Loads lazily: nothing is fetched until there is something to search for. Cached data shows first, then refreshes. */
function useSearchData(enabled: boolean) {
  const [mine, setMine] = useState<Mine | null>(mineCache?.data ?? null);
  const [programs, setPrograms] = useState<SearchProgram[] | null>(programsCache?.data ?? null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    if (!mineCache || Date.now() - mineCache.at > MINE_FRESH_MS || attempt > 0) {
      fetchMine().then((d) => { if (live) { setMine(d); setError(null); } }).catch((e: Error) => { if (live && !mineCache) setError(e.message); });
    }
    if (!programsCache || Date.now() - programsCache.at > PROGRAMS_FRESH_MS) {
      void fetchPrograms().then((p) => { if (live) setPrograms(p); });
    }
    return () => { live = false; };
  }, [enabled, attempt]);
  return { mine, programs, error, retry: () => setAttempt((n) => n + 1) };
}

/** Typing here filters as you go; the address bar follows after a short pause so Back still works. */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

const card = 'flex flex-wrap items-center justify-between gap-2 p-3 hover:border-accent';

function Results() {
  const params = useSearchParams(); const router = useRouter(); const pathname = usePathname();
  const urlQ = (params.get('q') ?? '').trim();
  const [input, setInput] = useState(urlQ);
  // Follow the header search box, but never rewrite what the student is typing (a trailing space would be lost).
  const pushed = useRef<string | null>(null);
  useEffect(() => { if (urlQ !== pushed.current) setInput((cur) => (cur.trim() === urlQ ? cur : urlQ)); pushed.current = null; }, [urlQ]);
  const q = useDebounced(input.trim(), 250);
  // Only the student's own typing (a change of q) updates the address bar, so a new search from the header is never undone.
  const lastQ = useRef(q);
  useEffect(() => {
    if (q === lastQ.current) return;
    lastQ.current = q;
    if (q === urlQ) return;
    pushed.current = q;
    router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname, { scroll: false });
  }, [q, urlQ, router, pathname]);

  const { mine, programs, error, retry } = useSearchData(!!q);
  const res = useMemo(() => (mine ? searchAll(q, { ...mine, programs: programs ?? [] }) : null), [mine, programs, q]);

  const box = (
    <form role="search" className="relative mb-4 max-w-xl" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor="search-page-input" className="sr-only">Search schools, programs, applications and essays</label>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-secondary" aria-hidden />
      <input id="search-page-input" type="search" value={input} onChange={(e) => setInput(e.target.value)} maxLength={100} autoComplete="off"
        placeholder="Try a school, a subject like finance, or an essay title"
        className="min-h-[44px] w-full rounded-xl border-2 bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:border-accent" />
    </form>
  );

  let body: React.ReactNode;
  if (!q) body = <EmptyState title="What are you looking for?" hint="Search your schools, applications and essays, plus every program we have researched. Try a subject like computer science or finance." />;
  else if (error && !mine) body = <ErrorBox message="We could not load your search just now. Check your connection and try again." onRetry={retry} />;
  else if (!res) body = <Loading label="Searching..." />;
  else {
    const total = res.schools.length + res.programsTotal + res.applications.length + res.essays.length;
    const programsLoading = programs === null;
    if (!total && !programsLoading) body = <EmptyState title={`No results for "${q}"`} hint="Try fewer words or a different spelling. Search covers school names, countries, programs and subjects, your applications and essay titles." />;
    else body = (
      <div className="space-y-6">
        <p className="text-sm text-secondary" role="status">{total} result{total === 1 ? '' : 's'} for &ldquo;{q}&rdquo;{programsLoading ? '. Still looking through programs...' : ''}</p>
        {res.schools.length > 0 && (
          <section aria-labelledby="sr-schools"><h2 id="sr-schools" className="mb-2 text-sm font-semibold">Schools ({res.schools.length})</h2>
            <ul className="space-y-2">{res.schools.map((s) => (
              <li key={s.id}><Link href={`/schools/${s.id}`}><Card className={card}>
                <div><p className="text-sm font-medium">{s.name}</p><p className="text-xs text-secondary">{[s.location, s.country].filter(Boolean).join(', ') || 'No location recorded'}</p></div>
                <div className="flex gap-1.5">{s.tier && <Badge>{TIER_LABEL[s.tier] ?? s.tier}</Badge>}{s.in_portfolio && <Badge tone="accent">In portfolio</Badge>}</div>
              </Card></Link></li>))}</ul></section>
        )}
        {res.programs.length > 0 && (
          <section aria-labelledby="sr-programs"><h2 id="sr-programs" className="mb-2 text-sm font-semibold">Programs ({res.programsTotal})</h2>
            <ul className="space-y-2">{res.programs.map((p) => (
              <li key={p.id}><Link href={p.schoolId ? `/schools/${p.schoolId}` : '/schools'} aria-label={`${p.program_name} at ${p.school_name}`}><Card className={card}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{p.program_name}</p>
                  <p className="text-xs text-secondary">{[p.school_name, p.format].filter(Boolean).join(' · ')}</p>
                  {p.subjectList.length > 0 && <p className="mt-1 text-xs text-secondary">Subjects: {p.subjectList.slice(0, 4).join(', ')}</p>}
                </div>
                <div className="flex gap-1.5">{p.degreeLabel && <Badge>{p.degreeLabel}</Badge>}{!p.schoolId && <Badge tone="neutral">Not on your list yet</Badge>}</div>
              </Card></Link></li>))}</ul>
            {res.programsTotal > res.programs.length && <p className="mt-2 text-xs text-secondary">Showing the first {res.programs.length}. Add another word to narrow it down.</p>}
          </section>
        )}
        {res.applications.length > 0 && (
          <section aria-labelledby="sr-apps"><h2 id="sr-apps" className="mb-2 text-sm font-semibold">Applications ({res.applications.length})</h2>
            <ul className="space-y-2">{res.applications.map((a) => (
              <li key={a.id}><Link href={`/applications?a=${a.id}`}><Card className={card}>
                <div><p className="text-sm font-medium">{a.schoolName}</p><p className="text-xs text-secondary">{[a.program, a.intake, a.round].filter(Boolean).join(' · ')}</p></div>
                <Badge>{STAGE_LABEL[a.stage as Stage] ?? titleCase(a.stage)}</Badge>
              </Card></Link></li>))}</ul></section>
        )}
        {res.essays.length > 0 && (
          <section aria-labelledby="sr-essays"><h2 id="sr-essays" className="mb-2 text-sm font-semibold">Essays ({res.essays.length})</h2>
            <ul className="space-y-2">{res.essays.map((e) => (
              <li key={e.id}><Link href={`/essays/${e.id}`}><Card className={card}>
                <div><p className="text-sm font-medium">{e.title}</p><p className="text-xs text-secondary">{e.schoolName ?? 'No school linked'}</p></div>
                <Badge>{ESSAY_STATUS_LABEL[e.status as EssayStatus] ?? titleCase(e.status)}</Badge>
              </Card></Link></li>))}</ul></section>
        )}
      </div>
    );
  }
  return <>{box}{body}</>;
}

export default function SearchPage() {
  return <div><PageHeader title="Search" subtitle="Schools, programs and subjects, your applications and essay titles." /><Suspense fallback={null}><Results /></Suspense></div>;
}
