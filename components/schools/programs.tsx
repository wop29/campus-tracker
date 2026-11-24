'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Briefcase, CalendarClock, ChevronDown, ExternalLink, GraduationCap, Rocket, Users, Wallet } from 'lucide-react';
import { Button, Card, EmptyState, ErrorBox, Loading, Pill } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { loadOnboarding } from '@/components/onboarding/data';
import type { Onboarding } from '@/lib/onboarding';
import { StartProgramDialog } from '@/components/applications/start-program-dialog';
import {
  COLLECTED_ON_LABEL, DEGREE_LABEL, IDR_RATE_NOTE, PROGRAM_COLS, compareScores, daysLeftText, englishChips, formatIdr, formatMoney, formatRoundDate, groupChecklist,
  isParaphrased, nextOpenRound, noStudentVisa, officialDomains, parsePrograms, parseRounds, programsForTrack, requirementChecklist, thirdPartySite, toIdr,
  type ClassProfile, type Employment, type Money, type Program, type Round, type UserScore,
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
        {em.median_base_salary
          ? <Stat label="Median base salary" value={em.median_base_salary} />
          : <Stat label="Average base salary" value={em.mean_base_salary} />}
        <div className="sm:col-span-2"><Stat label="Top industries" value={em.top_industries} /></div>
        <div className="sm:col-span-2"><Stat label="Top employers" value={em.top_employers} /></div>
        <div className="sm:col-span-2"><Stat label="For international students" value={em.international_employed_note} /></div>
      </dl>
    </section>
  );
}

/** Every round with its date. Past rounds are greyed out with "Closed"; the next open round is highlighted. */
function RoundsList({ rounds }: { rounds: Round[] }) {
  const next = nextOpenRound(rounds);
  return (
    <ul className="mt-2 space-y-1" aria-label="Application rounds">
      {rounds.map((r) => {
        const isNext = next === r;
        return (
          <li key={`${r.label}-${r.date}`} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-sm',
            r.closed ? 'bg-bg text-secondary' : isNext ? 'border-2 border-fun-green-dark bg-fun-green/15 font-bold text-ink' : 'text-ink')}>
            <span className={cn(r.closed && 'line-through decoration-1')}>{r.label}: {formatRoundDate(r.date)}</span>
            {r.closed ? <span className="text-xs font-bold">Closed</span>
              : isNext ? <span className="text-xs font-extrabold">Next open round · {daysLeftText(r.daysLeft)}</span>
              : <span className="text-xs text-secondary">{daysLeftText(r.daysLeft)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function MoneyLine({ label, m, official }: { label: string; m: Money; official: Set<string> }) {
  const idr = toIdr(m.amount, m.currency);
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold text-secondary">{label}{m.year && <span className="font-medium"> · {m.year}</span>}</dt>
      <dd className="text-sm text-ink">
        <span className="font-bold">{formatMoney(m)}</span>{m.basis && <span className="text-secondary"> {m.basis}</span>}
        {idr != null && m.currency !== 'IDR' && <span className="block text-xs text-secondary">About {formatIdr(idr)} ({IDR_RATE_NOTE.charAt(0).toLowerCase() + IDR_RATE_NOTE.slice(1, -1)})</span>}
        {m.source_url && <span className="mt-0.5 block"><Source url={m.source_url} official={official} /></span>}
      </dd>
    </div>
  );
}

/** Cost, fee waiver, scholarships and LPDP. Each part shows only when the research has it. */
function MoneySection({ p, official }: { p: Program; official: Set<string> }) {
  const { cost, fee_waiver: waiver, scholarships, lpdp } = p;
  if (!cost && !waiver && scholarships.length === 0 && !lpdp) return null;
  return (
    <section className="space-y-3 rounded-2xl border-2 bg-bg/60 p-3" aria-label="Cost and funding">
      <h4 className="flex items-center gap-1.5 text-sm font-extrabold text-ink"><Wallet size={15} aria-hidden /> Cost and funding</h4>
      {lpdp && lpdp.on_list != null && (
        <div className="flex flex-wrap items-center gap-2">
          {lpdp.on_list
            ? <Pill tone="green" icon={<BadgeCheck size={13} aria-hidden />}>On the LPDP list</Pill>
            : <Pill tone="neutral">Not on the LPDP list</Pill>}
          {lpdp.list_name && <span className="text-xs text-secondary">{lpdp.list_name}</span>}
          {lpdp.source_url && <Source url={lpdp.source_url} official={official} />}
        </div>
      )}
      {lpdp?.notes && <p className="text-sm text-secondary">{lpdp.notes}</p>}
      {cost && (cost.tuition || cost.living) && (
        <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
          {cost.tuition && <MoneyLine label="Tuition" m={cost.tuition} official={official} />}
          {cost.living && <MoneyLine label="Living costs" m={cost.living} official={official} />}
        </dl>
      )}
      {cost?.notes && <p className="text-sm text-secondary">{cost.notes}</p>}
      {waiver && (
        <div><p className="text-xs font-bold text-secondary">Application fee waiver</p><p className="text-sm text-ink">{waiver.value}</p>{waiver.source_url && <Source url={waiver.source_url} official={official} />}</div>
      )}
      {scholarships.length > 0 && (
        <div>
          <p className="text-xs font-bold text-secondary">Scholarships</p>
          <ul className="mt-1 space-y-1.5">
            {scholarships.map((s) => (
              <li key={s.name} className="rounded-xl border-2 bg-surface p-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-ink">{s.name}{s.amount && <span className="font-medium text-secondary"> · {s.amount}</span>}</span>
                  {s.source_url && <Source url={s.source_url} official={official} />}
                </div>
                {s.international_ok === true && <span className="text-xs font-bold text-success-ink">Open to international students</span>}
                {s.international_ok === false && <span className="text-xs font-bold text-secondary">Not open to international students</span>}
                {s.eligibility && <p className="text-secondary">{s.eligibility}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** How undergrads apply here: the application system and the aid policy for international students. */
function UndergradSection({ p, official }: { p: Program; official: Set<string> }) {
  if (!p.application_system && !p.aid_policy) return null;
  return (
    <section className="rounded-2xl border-2 bg-bg/60 p-3" aria-label="How to apply">
      <h4 className="mb-2 text-sm font-extrabold text-ink">How to apply</h4>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <Stat label="Apply through" value={p.application_system} />
        {p.aid_policy && (
          <div className="min-w-0"><dt className="text-xs font-bold text-secondary">Financial aid for international students</dt>
            <dd className="break-words text-sm text-ink">{p.aid_policy.value}{p.aid_policy.source_url && <span className="mt-0.5 block"><Source url={p.aid_policy.source_url} official={official} /></span>}</dd></div>
        )}
      </dl>
    </section>
  );
}

function ProgramCard({ p, schoolId, schoolName, startedId, scores, fallbackIntake, defaultOpen }: { p: Program; schoolId: string; schoolName: string; startedId: string | null; scores: UserScore[]; fallbackIntake?: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [starting, setStarting] = useState(false);
  const items = useMemo(() => requirementChecklist(p), [p]);
  const groups = useMemo(() => groupChecklist(items), [items]);
  const chips = englishChips(p);
  const ug = p.degree_type === 'undergrad';
  const compare = useMemo(() => (ug ? [] : compareScores(p.class_profile, scores)), [ug, p.class_profile, scores]);
  const rounds = useMemo(() => parseRounds(p.deadlines?.value), [p.deadlines]);
  const next = nextOpenRound(rounds);
  const essays = items.filter((i) => i.essay).length;
  const bodyId = `program-${p.id}`;
  const official = useMemo(() => officialDomains(p), [p]);
  const noVisa = noStudentVisa(p.notes);
  const paraphrasedNotes = p.paraphrased.notes;
  const essayNotesParaphrased = p.paraphrased.essays;

  return (
    <div className="rounded-2xl border-2 bg-surface shadow-[0_3px_0_var(--color-border)]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} className="flex w-full items-start gap-3 rounded-2xl p-4 text-left hover:bg-bg/60">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fun-purple text-on-fun" aria-hidden><GraduationCap size={18} /></span>
        <span className="min-w-0 flex-1 space-y-1.5">
          <span className="block font-extrabold text-ink">{p.program_name}</span>
          <span className="flex flex-wrap gap-1.5 text-xs text-secondary">
            <Pill tone="purple">{DEGREE_LABEL[p.degree_type]}</Pill>
            {p.lpdp?.on_list === true && <Pill tone="green">On the LPDP list</Pill>}
            {noVisa && <span className="inline-flex items-center rounded-full bg-danger/15 px-2.5 py-0.5 text-xs font-extrabold text-danger-ink">No student visa</span>}
            {[p.format, p.duration, p.intake].filter(Boolean).map((x) => <span key={x} className="rounded-full border-2 px-2 py-0.5 font-medium">{x}</span>)}
          </span>
          <span className="flex flex-wrap gap-1.5">{chips.map((c) => <span key={c.text} title={c.title}><Pill tone={c.tone}>{c.text}</Pill></span>)}</span>
          {rounds.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
              <CalendarClock size={14} aria-hidden />
              {next ? <>Next open round: {next.label}, {formatRoundDate(next.date)} <span className="text-secondary">({daysLeftText(next.daysLeft)})</span></> : <span className="text-secondary">All rounds listed for this cycle have closed</span>}
            </span>
          )}
        </span>
        <ChevronDown size={18} className={cn('mt-1 shrink-0 text-secondary transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={bodyId} className="space-y-4 border-t-2 p-4">
          {noVisa && p.notes && (
            <p className="rounded-2xl border-2 border-danger/40 bg-danger/10 p-3 text-sm text-danger-ink" role="note"><span className="font-extrabold">No student visa: </span>{p.notes}</p>
          )}
          {ug && <UndergradSection p={p} official={official} />}
          {((p.class_profile && !ug) || p.employment) && (
            <div className="grid gap-3 lg:grid-cols-2">
              {p.class_profile && !ug && <WhoGetsIn cp={p.class_profile} official={official} />}
              {p.employment && <WhereTheyGo em={p.employment} official={official} />}
            </div>
          )}
          <MoneySection p={p} official={official} />
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
                    {i.key === 'deadline' && rounds.length > 0 && <RoundsList rounds={rounds} />}
                    {i.key === 'deadline' && rounds.length === 0 && p.deadlines && <p className="mt-1 text-xs font-bold text-secondary">The school has not published round dates where we could find them. Check its admissions calendar for exact dates.</p>}
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-secondary">{i.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <div className="flex flex-wrap items-center gap-3 border-t-2 pt-3">
            {startedId
              ? <Link href={`/applications?a=${startedId}`} className="inline-flex items-center gap-1.5 rounded-2xl border-2 border-b-4 border-fun-blue-dark bg-fun-blue px-4 py-2.5 text-sm font-bold text-on-fun">Open your application</Link>
              : <Button onClick={() => setStarting(true)}><Rocket size={15} aria-hidden /> Start this application</Button>}
            {p.program_url && <Source url={p.program_url} label="Program page" official={official} />}
            <p className="w-full text-xs text-secondary">{startedId ? 'You already started an application for this program.' : `Starting adds this checklist${essays ? ` and ${essays} essay prompt${essays === 1 ? '' : 's'}` : ''} to a new application, so you can tick things off as you go.`}</p>
          </div>
          <StartProgramDialog open={starting} onClose={() => setStarting(false)} schoolId={schoolId} schoolName={schoolName} program={p} fallbackIntake={fallbackIntake} />
        </div>
      )}
    </div>
  );
}

/**
 * Researched programs for this school, filtered to the student's track.
 * onLoaded reports how many programs are shown, so the page can hide the manual catalogue when research exists.
 */
export function ProgramsSection({ schoolId, schoolName, shortName, onLoaded }: { schoolId: string; schoolName: string; shortName: string | null; onLoaded?: (shownCount: number) => void }) {
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
        sb.from('test_scores').select('test_type, exam_version, overall, quant, verbal').is('deleted_at', null).neq('status', 'planned').in('test_type', ['GMAT', 'GRE']),
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
  useEffect(() => { if (st) onLoaded?.(shown.length); }, [st, shown.length, onLoaded]);
  const undergrad = st?.ob.track === 'undergrad';

  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-lg font-extrabold text-ink">Programs and what you need</h2>
        {shown.length > 0 && <p className="text-xs text-secondary">Collected from the school&apos;s official site on {COLLECTED_ON_LABEL}. Always confirm on the school&apos;s page before you submit.</p>}
      </div>
      {error && <ErrorBox message={error} onRetry={() => void load()} />}
      {!st && !error && <Loading label="Loading programs..." />}
      {st && undergrad && shown.length === 0 && <UndergradNeeds />}
      {st && !undergrad && shown.length === 0 && (
        <EmptyState title="We haven't researched this school yet" hint={st.unavailable ? 'Program details are not available right now. Add what you know below, and check back soon.' : 'Add what you know below, such as deadlines and fees from the school\'s admissions page.'} />
      )}
      {st && shown.length > 0 && (
        <div className="space-y-3">
          {shown.map((p, i) => <ProgramCard key={p.id} p={p} schoolId={schoolId} schoolName={shortName ?? schoolName} startedId={st.started.get(p.id) ?? null} scores={st.scores} fallbackIntake={st.ob.intake} defaultOpen={i === 0 && shown.length === 1} />)}
        </div>
      )}
    </Card>
  );
}

const UNDERGRAD_NEEDS: [string, string][] = [
  ['School transcripts (rapor)', 'Your grades from the last 3 years of high school, often with an official English translation.'],
  ['English test', 'IELTS or TOEFL is the most common. Some schools also take Duolingo or PTE.'],
  ['SAT or ACT, if the school asks', 'Many US universities are test-optional. UK and Australian universities usually do not ask for them.'],
  ['Personal statement or essays', 'Why this subject, and what you have done to explore it.'],
  ['Counselor or teacher letters', 'Usually one counselor letter and one or two teacher letters for US schools; one reference for the UK.'],
  ['Financial documents', 'Proof you can pay tuition and living costs, such as a bank statement or a scholarship letter.'],
  ['Passport', 'Check it is valid for your whole study period.'],
];
/** A helpful generic list for undergrads when we have no undergrad research for this school yet. */
function UndergradNeeds() {
  return (
    <section className="space-y-3 rounded-2xl border-2 bg-bg/60 p-4" aria-label="What undergrads usually need">
      <div>
        <h3 className="font-extrabold text-ink">What undergrads usually need</h3>
        <p className="text-sm text-secondary">We have not collected this school&apos;s undergraduate requirements yet. Most universities ask for these, so you can start gathering them now.</p>
      </div>
      <ul className="space-y-1.5">
        {UNDERGRAD_NEEDS.map(([t, d]) => (
          <li key={t} className="rounded-xl border-2 bg-surface p-2.5 text-sm"><span className="font-bold text-ink">{t}</span><span className="block text-secondary">{d}</span></li>
        ))}
      </ul>
      <p className="text-xs text-secondary">Always check the university&apos;s own admissions page for its exact rules.</p>
      <Link href="/schools?view=find" className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border-2 border-b-4 border-fun-blue-dark bg-fun-blue px-4 py-2.5 text-sm font-bold text-on-fun">Search other universities</Link>
    </section>
  );
}
