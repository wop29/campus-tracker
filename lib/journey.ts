// The admissions journey as a short path: at most 5 units and about 10 small actions, tailored to the onboarding answers
// (track and stage). Every lesson is completed by REAL records only (counts and flags from the database, gathered by
// lib/gamification-data.ts). Lessons are never locked: the order is a recommendation. Late joiners skip early units:
// those lessons are shown as optional and are not counted against progress.
import type { Program, Stage, Track } from './onboarding.ts';

export type JourneyData = {
  profile: { education: number; work: number; leadership: number; achievements: number; tests: number; careerGoalsComplete: boolean; stories: number };
  schools: { inPortfolio: number; withTier: number; sourcedPoints: number; comparisons: number };
  applications: { total: number; withDeadline: number; requirementsComplete: number };
  essays: { total: number; withDraft: number; reviewedVersions: number; approved: number };
  recs: { recommenders: number; assigned: number; briefed: number; submitted: number };
  interview: { completedSessions: number; feedback: number };
  funding: { scholarships: number; expenses: number; scenarios: number };
  decide: { checklistStarted: number; submitted: number; decisionsRecorded: number; offersCompared: number };
  /** Optional: the user's active-track applications, oldest first, so steps can name the school ("Set the deadline for Duke Fuqua"). */
  apps?: JourneyApp[];
};
/** One application as the journey sees it. name is the school's short name (or full name). */
export type JourneyApp = { id: string; name: string; hasDeadline: boolean; submitted: boolean };
export const EMPTY_JOURNEY_DATA: JourneyData = {
  profile: { education: 0, work: 0, leadership: 0, achievements: 0, tests: 0, careerGoalsComplete: false, stories: 0 },
  schools: { inPortfolio: 0, withTier: 0, sourcedPoints: 0, comparisons: 0 },
  applications: { total: 0, withDeadline: 0, requirementsComplete: 0 },
  essays: { total: 0, withDraft: 0, reviewedVersions: 0, approved: 0 },
  recs: { recommenders: 0, assigned: 0, briefed: 0, submitted: 0 },
  interview: { completedSessions: 0, feedback: 0 },
  funding: { scholarships: 0, expenses: 0, scenarios: 0 },
  decide: { checklistStarted: 0, submitted: 0, decisionsRecorded: 0, offersCompared: 0 },
};

export type JourneyProfile = { track: Track; program?: Program; stage: Stage; english?: 'taken' | 'booked' | 'not_yet' };
export const DEFAULT_JOURNEY_PROFILE: JourneyProfile = { track: 'grad', stage: 'exploring' };

type LessonDef = { id: string; title: string; hint: string; href: string; measure: (d: JourneyData) => { current: number; target: number } };
type UnitDef = { id: string; title: string; blurb: string; color: 'green' | 'blue' | 'orange' | 'pink' | 'yellow' | 'purple'; lessons: LessonDef[] };
const atLeast = (current: number, target: number) => ({ current: Math.min(current, target), target });

function copyFor(p: JourneyProfile) {
  if (p.track === 'undergrad') return {
    tests: 'SAT, ACT, IELTS or TOEFL. A practice score is fine for now.',
    schoolsHint: 'Universities you would be happy at. You can change them anytime.',
    essay: 'personal statement', essayHint: 'Start your personal statement. Paste the prompt if you have it.',
    recommender: 'Line up your teacher letter', recHint: 'Letters, documents and the fee count too. Ask your teacher or counselor for the letter early.',
  };
  const mba = p.program === 'mba';
  return {
    tests: mba ? 'GMAT, GRE, IELTS or TOEFL. A practice score is fine for now.' : 'GRE, IELTS or TOEFL. A practice score is fine for now.',
    schoolsHint: mba ? 'Business schools you would be happy at. You can change them anytime.' : 'Programs you would be happy at. You can change them anytime.',
    essay: mba ? 'essay' : 'statement of purpose', essayHint: mba ? 'Start one essay. Paste the prompt and the word limit.' : 'Start your statement of purpose. Paste the prompt if you have it.',
    recommender: 'Line up your recommendation letters', recHint: mba ? 'Letters, essays and the fee count too. Ask your recommenders at least a month ahead.' : 'Letters, documents and the fee count too. Ask your professor or manager early.',
  };
}

/** "Set the deadline for Duke Fuqua": names the first unsubmitted application that has no deadline yet. */
function deadlineTitle(d: JourneyData): string {
  const apps = d.apps ?? [];
  const app = apps.find((a) => !a.hasDeadline && !a.submitted) ?? apps.find((a) => !a.hasDeadline);
  if (app) return `Set the deadline for ${app.name}`;
  return apps.length === 1 ? `Set the deadline for ${apps[0].name}` : 'Set a deadline for your application';
}

// ---------------------------------------------------------------------------------------------------------------
// Track filtering. An application belongs to a track when its program name says so; unclear names count for both
// tracks, so a student is never blocked by a program name we cannot read.
const UNDERGRAD_RE = /\b(bachelor'?s?|undergrad(uate)?|b\.?\s?a\.?|b\.?\s?sc?\.?|bcom|b\.?\s?eng|beng|freshman|first[- ]year|foundation)\b/i;
const GRAD_RE = /\b(mba|emba|master'?s?|m\.?\s?sc?\.?|msc|mim|m\.?\s?eng|meng|mphil|mpp|mpa|llm|ph\.?\s?d|doctora(te|l)|postgrad(uate)?|graduate)\b/i;
/** 'grad' or 'undergrad' when the program name makes it clear, else null. */
export function programTrack(program: string | null | undefined): Track | null {
  const p = (program ?? '').trim();
  if (!p) return null;
  const ug = UNDERGRAD_RE.test(p), gr = GRAD_RE.test(p);
  return ug && !gr ? 'undergrad' : gr && !ug ? 'grad' : null;
}
export const inTrack = (program: string | null | undefined, track: Track) => { const t = programTrack(program); return t === null || t === track; };

export type RawJourneyApp = { id: string; program: string | null; schoolName: string; hasDeadline: boolean; submitted: boolean; createdAt?: string };
export type RawJourneyEssay = { id: string; application_id: string | null; hasDraft: boolean };
/**
 * Applications and essays that count for the user's track. An essay counts when it is linked to an application on the
 * active track, or when it is not linked to any application yet (a personal statement written before picking schools).
 * Essays linked to another track's application (for example MBA essays on an undergrad path) never count.
 */
export function trackScope(apps: RawJourneyApp[], essays: RawJourneyEssay[], track: Track) {
  const active = apps.filter((a) => inTrack(a.program, track)).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
  const activeIds = new Set(active.map((a) => a.id));
  const counted = essays.filter((e) => (e.application_id ? activeIds.has(e.application_id) : true));
  return {
    apps: active.map((a): JourneyApp => ({ id: a.id, name: a.schoolName, hasDeadline: a.hasDeadline, submitted: a.submitted })),
    applications: { total: active.length, withDeadline: active.filter((a) => a.hasDeadline).length },
    submitted: active.filter((a) => a.submitted).length,
    essays: { total: counted.length, withDraft: counted.filter((e) => e.hasDraft).length },
  };
}

/** The tailored path. Same five-unit skeleton for everyone, with wording for grad or undergrad applicants. */
/** data is only used for wording that names an application ("Set the deadline for Duke Fuqua"). */
export function buildUnits(p: JourneyProfile = DEFAULT_JOURNEY_PROFILE, data: JourneyData = EMPTY_JOURNEY_DATA): UnitDef[] {
  const c = copyFor(p);
  return [
    { id: 'about-you', title: 'About you', blurb: 'A few basics so we can help.', color: 'green', lessons: [
      { id: 'add-education', title: 'Add your education', hint: p.track === 'undergrad' ? 'Your high school is enough to start.' : 'Your degree and university is enough to start.', href: '/profile', measure: (d) => atLeast(d.profile.education, 1) },
      p.english === 'not_yet'
        ? { id: 'add-test', title: 'Book your English test', hint: 'IELTS, TOEFL or Duolingo. Most schools need one. Add your score in Profile once you have it.', href: '/profile', measure: (d) => atLeast(d.profile.tests, 1) }
        : p.english === 'booked'
          ? { id: 'add-test', title: 'Add your English score after the test', hint: 'You booked it, nice. Add it in Profile as a planned test now, then the score later.', href: '/profile', measure: (d) => atLeast(d.profile.tests, 1) }
          : { id: 'add-test', title: 'Add a test score', hint: c.tests, href: '/profile', measure: (d) => atLeast(d.profile.tests, 1) },
    ] },
    { id: 'pick-schools', title: 'Pick schools', blurb: 'A short list beats a perfect one.', color: 'blue', lessons: [
      { id: 'add-schools', title: 'Add 3 schools to your list', hint: c.schoolsHint, href: '/schools', measure: (d) => atLeast(d.schools.inPortfolio, 3) },
      { id: 'mark-tier', title: 'Mark a dream or target school', hint: 'Just pick one. It helps you plan.', href: '/schools?view=mine', measure: (d) => atLeast(d.schools.withTier, 1) },
    ] },
    { id: 'plan', title: 'Plan', blurb: 'Turn one school into a plan.', color: 'orange', lessons: [
      { id: 'create-app', title: 'Create one application', hint: 'Pick a school and a round or intake.', href: '/applications', measure: (d) => atLeast(d.applications.total, 1) },
      { id: 'set-deadline', title: deadlineTitle(data), hint: 'Copy the date from the school website.', href: '/applications', measure: (d) => atLeast(d.applications.withDeadline, 1) },
    ] },
    { id: 'write', title: 'Write', blurb: 'Small drafts add up.', color: 'pink', lessons: [
      { id: 'create-essay', title: `Create your ${c.essay}`, hint: c.essayHint, href: '/essays', measure: (d) => atLeast(d.essays.total, 1) },
      { id: 'first-draft', title: 'Save a first draft', hint: 'A messy draft is perfect. You can polish later.', href: '/essays', measure: (d) => atLeast(d.essays.withDraft, 1) },
    ] },
    { id: 'finish', title: 'Finish', blurb: 'The finish line.', color: 'purple', lessons: [
      { id: 'finish-checklist', title: 'Tick off every item for one application', hint: c.recHint, href: '/applications', measure: (d) => atLeast(Math.max(d.applications.requirementsComplete, d.decide.submitted), 1) },
      { id: 'submit-app', title: 'Submit an application', hint: 'Mark it submitted once you hit send. You did it!', href: '/applications', measure: (d) => atLeast(d.decide.submitted, 1) },
    ] },
  ];
}
/** Default (grad, exploring) path. Kept for callers that do not know the onboarding answers. */
export const UNITS: UnitDef[] = buildUnits();

/** How many leading units a late joiner skips: 'applying' starts at Plan, 'submitted' starts at Finish. */
export function skippedUnitCount(stage: Stage): number {
  return stage === 'applying' ? 2 : stage === 'submitted' ? 4 : 0;
}

export type LessonState = 'done' | 'current' | 'upcoming' | 'skipped';
/** number is the 1-based position among the lessons that count (not skipped); null for skipped lessons. */
export type Lesson = { id: string; title: string; hint: string; href: string; state: LessonState; current: number; target: number; number: number | null };
/** total counts only lessons that are not skipped; skipped is how many optional lessons were skipped in this unit. */
export type Unit = { id: string; title: string; blurb: string; color: UnitDef['color']; index: number; lessons: Lesson[]; doneCount: number; total: number; skipped: number; pct: number; crowned: boolean };
/** step is the number of the current lesson ("Step 3 of 10", the same number the path shows); data is the raw input so pages can recompute for a profile. */
export type Journey = { units: Unit[]; overallPct: number; doneCount: number; total: number; step: number; skipped: number; currentLessonId: string | null; currentUnitId: string | null; profile: JourneyProfile; data: JourneyData };

export function computeJourney(data: JourneyData, profile: JourneyProfile = DEFAULT_JOURNEY_PROFILE): Journey {
  let currentId: string | null = null, currentUnit: string | null = null;
  const skipBefore = skippedUnitCount(profile.stage);
  const units: Unit[] = buildUnits(profile, data).map((u, index) => {
    const lessons: Lesson[] = u.lessons.map((l) => {
      const m = l.measure(data), done = m.current >= m.target;
      let state: LessonState;
      if (done) state = 'done';
      else if (index < skipBefore) state = 'skipped';
      else if (currentId === null) { currentId = l.id; currentUnit = u.id; state = 'current'; }
      else state = 'upcoming';
      return { id: l.id, title: l.title, hint: l.hint, href: l.href, state, current: m.current, target: m.target, number: null };
    });
    const doneCount = lessons.filter((l) => l.state === 'done').length;
    const skipped = lessons.filter((l) => l.state === 'skipped').length;
    const total = lessons.length - skipped;
    return { id: u.id, title: u.title, blurb: u.blurb, color: u.color, index, lessons, doneCount, total, skipped, pct: total ? Math.round((doneCount / total) * 100) : 0, crowned: total > 0 && doneCount === total };
  });
  const doneCount = units.reduce((s, u) => s + u.doneCount, 0), total = units.reduce((s, u) => s + u.total, 0);
  const skipped = units.reduce((s, u) => s + u.skipped, 0);
  // One numbering for the banner and the path: skipped lessons get no number, every other lesson is numbered in order.
  let num = 0;
  for (const u of units) for (const l of u.lessons) if (l.state !== 'skipped') l.number = ++num;
  const currentLesson = units.flatMap((u) => u.lessons).find((l) => l.id === currentId);
  return {
    units, overallPct: total ? Math.round((doneCount / total) * 100) : 100, doneCount, total, step: currentLesson?.number ?? Math.max(1, total), skipped,
    currentLessonId: currentId, currentUnitId: currentUnit, profile, data,
  };
}

/** The single "do this next" step that Journey, Overview and the Overview strip all show. null when the path is complete. */
export type NextStep = { id: string; title: string; hint: string; href: string; step: number; total: number; unitTitle: string | null; current: number; target: number };
export function nextStep(j: Journey): NextStep | null {
  for (const u of j.units) for (const l of u.lessons) {
    if (l.id !== j.currentLessonId) continue;
    return { id: l.id, title: l.title, hint: l.hint, href: l.href, step: l.number ?? j.step, total: j.total, unitTitle: u.title, current: l.current, target: l.target };
  }
  return null;
}
