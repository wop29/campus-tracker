'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Briefcase, ChevronDown, ExternalLink, GraduationCap, Rocket, Users } from 'lucide-react';
import { Button, Card, EmptyState, ErrorBox, Loading, Pill } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { friendlyDbError } from '@/lib/applications';
import { loadOnboarding } from '@/components/onboarding/data';
import type { Onboarding } from '@/lib/onboarding';
import { startProgramApplication } from '@/components/applications/program-start';
import {
  COLLECTED_ON_LABEL, DEGREE_LABEL, PROGRAM_COLS, compareScores, isParaphrased, noStudentVisa, officialDomains, thirdPartySite, englishSummary, groupChecklist, parsePrograms, programsForTrack, requirementChecklist,
  type ClassProfile, type Employment, type Program, type UserScore,
} from '@/lib/programs';
import { cn } from '@/lib/utils';

type Loaded = { programs: Program[]; ob: Onboarding; started: Map<string, string>; scores: UserScore[]; unavailable: boolean };

/** Source link. When the link is not the school's own site, an amber tag says who reported the figure. */
function Source({ url, label = 'Source', official }: { url: string | null; label?: string; official: Set<string> }) {
  if (!url) return <span className="text-xs text-secondary">No source link</span>;
  const site = thirdPartySite(url, official);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {site && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning-ink">Reported by {site}, not the school</span>}
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-accent hover:underline">{label} <ExternalLink size={11} aria-hidden /></a>
    </span>
  );
}
const ParaphraseTag = () => <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-bold text-warning-ink">Paraphrased, check the official wording</span>;

const chipTone = (c: string) => (/not accepted/i.test(c) ? 'pink' : /not stated/i.test(c) ? 'neutral' : 'blue') as 'blue';
const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(n < 10 ? 2 : 1).replace(/0+$/, '').replace(/\.$/, ''));

function Stat({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return <div className="min-w-0"><dt className="text-xs font-bold text-secondary">{label}</dt><dd className="break-words text-sm text-ink">{value}</dd></div>;
}

function WhoGetsIn({ cp, official }: { cp: ClassProfile; official: Set<string> }) {
  const gmat = [cp.gmat_median != null ? `median ${cp.gmat_median}` : cp.gmat_avg != null ? `average ${cp.gmat_avg}` : null, cp.gmat_range].filter(Boolean).join('; ') || null;
  const focus = [cp.gmat_focus_median != null ? `median ${cp.gmat_focus_median}` : null, cp.gmat_focus_range].filter(Boolean).join('; ') || null;
  const greAvg = cp.gre_verbal_avg != null || cp.gre_quant_avg != null ? `average V ${cp.gre_verbal_avg ?? '?'}, Q ${cp.gre_quant_avg ?? '?'}` : null;
  const gre = [greAvg, cp.gre_range].filter(Boolean).join('; ') || null;
  const gpa = [cp.gpa_avg != null ? `average ${fmtNum(cp.gpa_avg)}` : null, cp.gpa_range].filter(Boolean).join('; ') || null;
  const work = [cp.work_exp_avg_years != null ? `${fmtNum(cp.work_exp_avg_years)} years on average` : null, cp.work_exp_range].filter(Boolean).join('; ') || null;
  return (
    <section className="rounded-2xl border-2 bg-bg/60 p-3" aria-label="Who gets in">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-extrabold text-ink"><Users size={15} aria-hidden /> Who gets in{cp.class_label && <span className="font-medium text-secondary">· {cp.class_label}</span>}</h4>
        <Source url={cp.source_url} label={cp.source_name ? 'Class profile' : 'Source'} official={official} />
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Stat label="GMAT (Classic)" value={gmat} /><Stat label="GMAT Focus" value={focus} /><Stat label="GRE" value={gre} /><Stat label="GPA" value={gpa} />
        <Stat label="Work experience" value={work} /><Stat label="Class size" value={cp.class_size != null ? String(cp.class_size) : null} />
        <Stat label="International students" value={cp.international_pct != null ? `${fmtNum(cp.international_pct)}%` : null} />
      </dl>
    </section>
  );
}

function WhereTheyGo({ em, official }: { em: Employment; official: Set<string> }) {
  return (
    <section className="rounded-2xl border-2 bg-bg/60 p-3" aria-label="Where they go">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-extrabold text-ink"><Briefcase size={15} aria-hidden /> Where they go{em.report_label && <span className="font-medium text-secondary">· {em.report_label}</span>}</h4>
        <Source url={em.source_url} label="Employment report" official={official} />
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Stat label="Employed within 3 months" value={em.employed_3_months_pct != null ? `${fmtNum(em.employed_3_months_pct)}%` : null} />
        <Stat label="Median base salary" value={em.median_base_salary ?? (em.mean_base_salary ? `${em.mean_base_salary} (average)` : null)} />
        <div className="sm:col-span-2"><Stat label="Top industries" value={em.top_industries} /></div>
        <div className="sm:col-span-2"><Stat label="Top employers" value={em.top_employers} /></div>
        <div className="sm:col-span-2"><Stat label="For international students" value={em.international_employed_note} /></div>
      </dl>
    </section>
  );
}

function ProgramCard({ p, schoolId, startedId, scores, fallbackIntake, defaultOpen }: { p: Program; schoolId: string; startedId: string | null; scores: UserScore[]; fallbackIntake?: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const items = useMemo(() => requirementChecklist(p), [p]);
  const groups = useMemo(() => groupChecklist(items), [items]);
  const chips = englishSummary(p);
  const compare = useMemo(() => compareScores(p.class_profile, scores), [p.class_profile, scores]);
  const essays = items.filter((i) => i.essay).length;
  const bodyId = `program-${p.id}`;
  const official = useMemo(() => officialDomains(p), [p]);
  const noVisa = noStudentVisa(p.notes);
  const paraphrasedNotes = isParaphrased(p.notes);
  const essayNotesParaphrased = /paraphras[^.]*(essay|prompt)|(essay|prompt)[^.]*paraphras/i.test(p.notes ?? '');

  async function start() {
    if (busy) return; setBusy(true);
    try {
      const id = await startProgramApplication(supabaseBrowser(), { schoolId, program: p, fallbackIntake });
      toast(`Application started with ${items.length} checklist items${essays ? ` and ${essays} essay${essays === 1 ? '' : 's'}` : ''}`);
      router.push(`/applications?a=${id}`);
    } catch (e) { toast(friendlyDbError(e instanceof Error ? e.message : String(e)), 'err'); setBusy(false); }
  }

  return (
    <div className="rounded-2xl border-2 bg-surface shadow-[0_3px_0_var(--color-border)]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} className="flex w-full items-start gap-3 rounded-2xl p-4 text-left hover:bg-bg/60">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fun-purple text-on-fun" aria-hidden><GraduationCap size={18} /></span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block font-extrabold text-ink">{p.program_name}</span>
          <span className="flex flex-wrap gap-1.5 text-xs text-secondary">
            <Pill tone="purple">{DEGREE_LABEL[p.degree_type]}</Pill>
            {noVisa && <span className="inline-flex items-center rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-extrabold text-danger-ink">No student visa</span>}
            {[p.format, p.duration, p.intake].filter(Boolean).map((x) => <span key={x} className="rounded-full border-2 px-2 py-0.5 font-medium">{x}</span>)}
          </span>
          <span className="flex flex-wrap gap-1.5">{chips.map((c) => <Pill key={c} tone={chipTone(c)}>{c}</Pill>)}</span>
        </span>
        <ChevronDown size={18} className={cn('mt-1 shrink-0 text-secondary transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={bodyId} className="space-y-4 border-t-2 p-4">
          {noVisa && p.notes && (
            <p className="rounded-2xl border-2 border-danger/40 bg-danger/10 p-3 text-sm text-danger-ink" role="note"><span className="font-extrabold">No student visa: </span>{p.notes}</p>
          )}
          {(p.class_profile || p.employment) && (
            <div className="grid gap-3 lg:grid-cols-2">
              {p.class_profile && <WhoGetsIn cp={p.class_profile} official={official} />}
              {p.employment && <WhereTheyGo em={p.employment} official={official} />}
            </div>
          )}
          {compare.length > 0 && (
            <section className="rounded-2xl border-2 border-fun-yellow-dark/40 bg-fun-yellow/15 p-3" aria-label="How you compare">
              <h4 className="text-sm font-extrabold text-ink">How you compare</h4>
              <ul className="mt-1 space-y-0.5 text-sm text-ink">{compare.map((c) => <li key={c.test}>{c.text}</li>)}</ul>
              <p className="mt-1 text-xs text-secondary">This only shows where your saved score sits next to the published numbers. Scores are one part of the picture, and it is not a prediction of your result.</p>
            </section>
          )}
          {groups.map((g) => (
            <section key={g.group} aria-label={g.label}>
              <h4 className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-secondary">{g.label}</h4>
              <ul className="space-y-2">
                {g.items.map((i) => (
                  <li key={i.key} className="rounded-xl border-2 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-bold text-ink">{i.name}{!i.mandatory && <span className="ml-1.5 text-xs font-medium text-secondary">(if it applies to you)</span>}</p>
                      <Source url={i.source_url} official={official} />
                    </div>
                    {(i.essay ? isParaphrased(i.essay.prompt) || essayNotesParaphrased : i.key === 'transcripts' ? paraphrasedNotes : isParaphrased(i.detail)) && <div className="mt-1"><ParaphraseTag /></div>}
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-secondary">{i.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex flex-wrap items-center gap-3 border-t-2 pt-3">
            {startedId
              ? <Link href={`/applications?a=${startedId}`} className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-b-4 border-fun-blue-dark bg-fun-blue px-4 py-2.5 text-sm font-bold text-on-fun">Open your application</Link>
              : <Button onClick={() => void start()} disabled={busy}><Rocket size={15} aria-hidden /> {busy ? 'Setting it up...' : 'Start this application'}</Button>}
            {p.program_url && <Source url={p.program_url} label="Program page" official={official} />}
            <p className="w-full text-xs text-secondary">{startedId ? 'You already started an application for this program.' : `Starting adds this checklist${essays ? ` and ${essays} essay prompt${essays === 1 ? '' : 's'}` : ''} to a new application, so you can tick things off as you go.`}</p>
          </div>
        </div>
      )}
    </div>
  );
}

export function ProgramsSection({ schoolId, schoolName, shortName }: { schoolId: string; schoolName: string; shortName: string | null }) {
  const [st, setSt] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const sb = supabaseBrowser();
      const names = [schoolName, shortName].filter((n): n is string => !!n);
      const [ob, progs, apps, scores] = await Promise.all([
        loadOnboarding(sb),
        sb.from('program_requirements').select(PROGRAM_COLS).in('school_name', names).order('program_name'),
        sb.from('applications').select('id, program_requirement_id').eq('school_id', schoolId).is('deleted_at', null).not('program_requirement_id', 'is', null),
        sb.from('test_scores').select('test_type, exam_version, overall, quant, verbal').is('deleted_at', null).in('test_type', ['GMAT', 'GRE']),
      ]);
      const started = new Map<string, string>();
      for (const a of (apps.data ?? []) as { id: string; program_requirement_id: string }[]) started.set(a.program_requirement_id, a.id);
      // A missing table (migration not applied yet) shows the empty state rather than an error.
      setSt({ ob, programs: parsePrograms(progs.data), started, scores: (scores.data ?? []) as UserScore[], unavailable: !!progs.error });
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [schoolId, schoolName, shortName]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => (st ? programsForTrack(st.programs, st.ob.track, st.ob.program) : []), [st]);

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-lg font-extrabold text-ink">Programs and what you need</h2>
        <p className="text-xs text-secondary">Collected from the school&apos;s official site on {COLLECTED_ON_LABEL}. Always confirm on the school&apos;s page before you submit.</p>
      </div>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!st && !error && <Loading label="Loading programs..." />}
      {st && st.ob.track === 'undergrad' && (
        <EmptyState pose="search" title="Undergraduate programs are coming soon" hint="We are gathering what each school asks of undergraduate applicants. For now this list covers graduate programs only." />
      )}
      {st && st.ob.track !== 'undergrad' && shown.length === 0 && (
        <EmptyState title="No programs here yet" hint={st.unavailable ? 'Program details are not available yet. Check back soon.' : 'We have not collected the programs for this school yet. Check back soon, or use the school\'s admissions page for now.'} />
      )}
      {st && st.ob.track !== 'undergrad' && shown.length > 0 && (
        <div className="space-y-3">
          {shown.map((p, i) => <ProgramCard key={p.id} p={p} schoolId={schoolId} startedId={st.started.get(p.id) ?? null} scores={st.scores} fallbackIntake={st.ob.intake} defaultOpen={i === 0 && shown.length === 1} />)}
        </div>
      )}
    </Card>
  );
}
