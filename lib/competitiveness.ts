// Transparent, rules-based self-assessment. Every score is computed from the applicant's own records;
// nothing here knows or claims what any school requires. School expectations come only from sourced rows.
import { filled, fmtMonthYear, latestValidScores, words, ENGLISH_TESTS, NARRATIVE_KEYS, TEST_LABEL, UNDERGRAD_TESTS, type AchievementRow, type EducationRow, type GoalsRow, type LeadershipRow, type ProfileProgram, type ProfileRow, type ProfileTrack, type TestRow, type TestType, type WorkRow } from './profile.ts';
import { dataFlags, flagWords, FIELD_BY_KEY, formatValue, isSourced, type DataRow } from './schools.ts';

export type DimKey = 'academics' | 'test' | 'experience' | 'progression' | 'leadership' | 'extracurriculars' | 'international' | 'clarity' | 'differentiation'
  | 'grades' | 'english' | 'sat' | 'activities' | 'essays' | 'recommendations';
export type Confidence = 'low' | 'medium' | 'high';
export interface Dimension {
  key: DimKey; label: string; score: number | null; confidence: Confidence | null; rule: string;
  evidence: string[]; expectations: string[]; weaknesses: string[]; improvements: string[]; insufficientReason?: string;
  /** Optional dimensions (for example SAT for test-optional schools) are shown but never count as a gap. */
  optional?: boolean;
}
/** Light essay and recommender facts for the undergrad dimensions. */
export interface EssayLite { id: string; status: string; words: number }
export interface RecommenderLite { id: string; statuses: string[] }
export interface SchoolDataRow extends DataRow { school_name: string }
export interface AssessInput {
  profile: ProfileRow | null; education: EducationRow[]; tests: TestRow[]; work: WorkRow[]; leadership: LeadershipRow[]; achievements: AchievementRow[];
  goals: GoalsRow | null; schoolData: SchoolDataRow[]; now?: Date;
  track?: ProfileTrack; program?: ProfileProgram; essays?: EssayLite[]; recommenders?: RecommenderLite[];
}
export const DISCLAIMER = 'This is a qualitative self-assessment tool built from the records you entered. It is not an official admissions evaluation, it does not predict outcomes, and schools do not score applicants this way. Use it to spot gaps, not to judge your chances.';

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));
const bands = (v: number, cuts: number[]) => 1 + cuts.filter((c) => v >= c).length; // cuts ascending; returns 1..cuts.length+1

/** Total months of work experience with overlapping jobs merged. end_date empty means current role. */
export function workMonths(work: WorkRow[], now: Date): number {
  const iv = work.filter((w) => w.start_date).map((w) => [Date.parse(w.start_date!), Date.parse(w.end_date ?? now.toISOString().slice(0, 10))] as [number, number]).filter(([s, e]) => !Number.isNaN(s) && !Number.isNaN(e) && e >= s).sort((a, b) => a[0] - b[0]);
  let total = 0; let cs = -1; let ce = -1;
  for (const [s, e] of iv) { if (cs < 0) { cs = s; ce = e; } else if (s <= ce) ce = Math.max(ce, e); else { total += ce - cs; cs = s; ce = e; } }
  if (cs >= 0) total += ce - cs;
  return Math.round(total / (1000 * 60 * 60 * 24 * 30.4375));
}
const yrs = (m: number) => `${(m / 12).toFixed(1)} years`;
const monthsBetween = (a?: string | null, b?: string | null, now?: Date) => { if (!a) return 0; const s = Date.parse(a); const e = Date.parse(b ?? (now ?? new Date()).toISOString().slice(0, 10)); return Number.isNaN(s) || Number.isNaN(e) || e < s ? 0 : Math.round((e - s) / (1000 * 60 * 60 * 24 * 30.4375)); };

function expectations(rows: SchoolDataRow[], fields: string[], now: Date): string[] {
  const out = rows.filter((r) => fields.includes(r.field) && isSourced(r)).map((r) => {
    const f = flagWords(dataFlags(r, now)); const def = FIELD_BY_KEY[r.field];
    return `${r.school_name}: ${def?.label ?? r.field} ${formatValue(def, r)} (${r.source_name}, ${r.publication_year ?? 'year unknown'}${f.length ? `, ${f.join(', ')}` : ''})`;
  });
  return out.length ? out : ['No sourced school data. Add sourced data points on a school page to compare.'];
}
const insufficient = (key: DimKey, label: string, rule: string, reason: string, improvements: string[]): Dimension => ({ key, label, score: null, confidence: null, rule, evidence: [], expectations: [], weaknesses: [], improvements, insufficientReason: reason });

export function assess(inp: AssessInput): Dimension[] {
  if (inp.track === 'undergrad') return assessUndergrad(inp);
  const now = inp.now ?? new Date(); const sd = inp.schoolData;
  const out: Dimension[] = [];

  // 1 Academics
  {
    const rule = 'Uses the best GPA ratio (GPA divided by GPA scale) across your education records. Score 5 if at least 90%, 4 if at least 80%, 3 if at least 70%, 2 if at least 60%, otherwise 1. GPA conventions differ by country, so treat this as a rough signal.';
    const recs = inp.education.filter((e) => e.gpa != null && e.gpa_scale);
    if (!recs.length) out.push(insufficient('academics', 'Academics', rule, 'No education record has both a GPA and a GPA scale.', ['Add GPA and GPA scale to your education records.']));
    else {
      const best = recs.reduce((a, b) => (b.gpa! / b.gpa_scale! > a.gpa! / a.gpa_scale! ? b : a));
      const ratio = best.gpa! / best.gpa_scale!; const score = bands(ratio, [0.6, 0.7, 0.8, 0.9]);
      const conf: Confidence = best.enrollment_status !== 'completed' ? 'low' : (best.honors || inp.education.length > 1) ? 'high' : 'medium';
      const ev = inp.education.map((e) => `${e.institution}${e.degree ? `, ${e.degree}` : ''}${e.gpa != null && e.gpa_scale ? `: GPA ${e.gpa}/${e.gpa_scale}` : ': no GPA recorded'}${e.honors ? `, honors: ${e.honors}` : ''} (${e.enrollment_status})`);
      out.push({ key: 'academics', label: 'Academics', score, confidence: conf, rule, evidence: ev, expectations: expectations(sd, ['avg_gpa'], now),
        weaknesses: [...(score <= 2 ? [`Best GPA ratio is ${(ratio * 100).toFixed(0)}%, in the lower bands of this rule.`] : []), ...(best.enrollment_status !== 'completed' ? ['The strongest record is not a completed degree, so confidence is low.'] : [])],
        improvements: [...(score <= 3 ? ['Consider evidence of quantitative strength such as coursework, certifications or a strong test score.'] : []), ...(!best.honors ? ['Record honors or class rank if you have them.'] : [])] });
    }
  }

  // 2 GMAT/GRE
  {
    const rule = 'Takes your best currently valid GMAT or GRE (GMAT and GRE are valid 5 years from test date). Measures where the score sits within the scale: GMAT (total - 200) / 600, GRE ((verbal + quant) / 2 - 130) / 40. Score 5 if at least 90%, 4 if at least 83%, 3 if at least 77%, 2 if at least 70%, otherwise 1. Scale position is not a percentile, and no school average is used in the score.';
    const l = latestValidScores(inp.tests, now).filter((x) => x.type === 'GMAT' || x.type === 'GRE');
    const cand = l.map((x) => x.latestValid).filter(Boolean) as TestRow[];
    const pos = (t: TestRow) => (t.test_type === 'GMAT' ? (t.overall != null ? (t.overall - 200) / 600 : null) : t.verbal != null && t.quant != null ? ((t.verbal + t.quant) / 2 - 130) / 40 : null);
    const scored = cand.map((t) => ({ t, p: pos(t) })).filter((x) => x.p != null) as { t: TestRow; p: number }[];
    if (!scored.length) {
      const exp = l.some((x) => x.expired.length);
      out.push(insufficient('test', 'GMAT/GRE', rule, exp ? 'Your GMAT/GRE record is expired (older than 5 years).' : l.length ? 'Your test record has no valid total (GMAT) or verbal and quant (GRE).' : 'No GMAT or GRE record.', ['Add a valid GMAT or GRE score, or check whether your target schools waive it.']));
    } else {
      const b = scored.reduce((a, c) => (c.p > a.p ? c : a)); const score = bands(b.p, [0.7, 0.77, 0.83, 0.9]);
      const hasSchool = sd.some((r) => r.field === 'avg_gmat' && isSourced(r));
      const conf: Confidence = hasSchool ? 'high' : 'medium';
      const ev = scored.map(({ t }) => t.test_type === 'GMAT' ? `GMAT ${t.exam_version ?? ''} total ${t.overall}${t.test_date ? ` on ${t.test_date}` : ''}` : `GRE verbal ${t.verbal}, quant ${t.quant}${t.test_date ? ` on ${t.test_date}` : ''}`);
      out.push({ key: 'test', label: 'GMAT/GRE', score, confidence: conf, rule, evidence: ev, expectations: expectations(sd, ['avg_gmat', 'avg_gre'], now),
        weaknesses: score <= 2 ? ['Score sits in the lower bands of the scale.'] : [], improvements: [...(score <= 3 ? ['A retake could help if your section scores show room to improve.'] : [])],
      });
    }
  }

  // 3 Professional experience
  {
    const rule = 'Total months of work experience from your work records, with overlapping jobs counted once and a missing end date meaning current. Score 5 if at least 6 years, 4 if at least 4.5 years, 3 if at least 3 years, 2 if at least 2 years, otherwise 1.';
    const months = workMonths(inp.work, now);
    if (!inp.work.length || months === 0) out.push(insufficient('experience', 'Professional experience', rule, 'No work record with a start date.', ['Add your work history with start and end dates.']));
    else {
      const score = bands(months, [24, 36, 54, 72]); const undated = inp.work.filter((w) => !w.start_date).length;
      out.push({ key: 'experience', label: 'Professional experience', score, confidence: undated ? 'low' : inp.work.length >= 2 ? 'high' : 'medium', rule,
        evidence: [`${yrs(months)} across ${inp.work.length} role${inp.work.length === 1 ? '' : 's'}`, ...inp.work.map((w) => `${w.position}, ${w.company}${w.start_date ? ` (${w.start_date} to ${w.end_date ?? 'present'})` : ' (no start date)'}`)],
        expectations: expectations(sd, ['avg_work_experience'], now), weaknesses: [...(score <= 2 ? ['Fewer years than the upper bands of this rule.'] : []), ...(undated ? [`${undated} role(s) lack a start date and are not counted.`] : [])],
        improvements: [...(inp.work.some((w) => !filled(w.measurable_impact)) ? ['Add measurable impact to each role.'] : [])] });
    }
  }

  // 4 Career progression
  {
    const rule = 'Starts at 1. Adds 1 for each role (max 2) where you recorded a promotion, 1 if any role records team size or budget ownership, 1 if any role records measurable impact, and 1 if you held at least 2 different positions. Capped at 5.';
    if (!inp.work.length) out.push(insufficient('progression', 'Career progression', rule, 'No work records.', ['Add work experience including promotions and impact.']));
    else {
      const promo = inp.work.filter((w) => filled(w.promotions)); const scope = inp.work.filter((w) => (w.team_size ?? 0) > 0 || filled(w.budget_ownership)); const impact = inp.work.filter((w) => filled(w.measurable_impact));
      const positions = new Set(inp.work.map((w) => `${w.position}`.trim().toLowerCase())).size;
      const score = clamp(1 + Math.min(2, promo.length) + (scope.length ? 1 : 0) + (impact.length ? 1 : 0) + (positions >= 2 ? 1 : 0));
      out.push({ key: 'progression', label: 'Career progression', score, confidence: inp.work.length >= 3 ? 'high' : inp.work.length === 2 ? 'medium' : 'low', rule,
        evidence: [`${promo.length} role(s) with promotions recorded`, `${scope.length} role(s) with team size or budget recorded`, `${impact.length} role(s) with measurable impact`, `${positions} distinct position title(s)`],
        expectations: ['No sourced school data. Schools do not publish progression criteria in the data model.'],
        weaknesses: [...(!promo.length ? ['No promotions recorded. If none, describe scope growth instead.'] : []), ...(!impact.length ? ['No measurable impact recorded.'] : [])],
        improvements: [...(!scope.length ? ['Record team size or budget you owned.'] : []), ...(!impact.length ? ['Quantify results for your most recent role.'] : [])] });
    }
  }

  // 5 Leadership
  {
    const rule = 'Starts at 1. Adds 1 for each leadership record (max 2) that describes what you led, 1 if any leadership record or achievement states an outcome, social impact or award, 1 if any work role records a team size above 0, and 1 if any work role records budget ownership. Capped at 5.';
    const led = inp.leadership.filter((l) => filled(l.leadership_experience) || filled(l.responsibilities));
    const team = inp.work.filter((w) => (w.team_size ?? 0) > 0); const budget = inp.work.filter((w) => filled(w.budget_ownership));
    if (!inp.leadership.length && !team.length && !budget.length) out.push(insufficient('leadership', 'Leadership', rule, 'No leadership records and no team size or budget on work roles.', ['Add leadership roles, or record team size and budget on your work roles.']));
    else {
      const outcome = inp.leadership.some((l) => filled(l.achievements) || filled(l.social_impact) || filled(l.awards));
      const score = clamp(1 + Math.min(2, led.length) + (outcome ? 1 : 0) + (team.length ? 1 : 0) + (budget.length ? 1 : 0));
      const n = inp.leadership.length + team.length;
      out.push({ key: 'leadership', label: 'Leadership', score, confidence: n >= 3 ? 'high' : n === 2 ? 'medium' : 'low', rule,
        evidence: [...inp.leadership.map((l) => `${l.role ?? 'Role not stated'}, ${l.organization}`), ...team.map((w) => `Team of ${w.team_size} at ${w.company}`), ...budget.map((w) => `Budget ownership at ${w.company}: ${w.budget_ownership}`)],
        expectations: ['No sourced school data. Leadership is assessed qualitatively by schools.'],
        weaknesses: [...(!outcome ? ['No leadership outcome, impact or award recorded.'] : [])], improvements: [...(inp.leadership.length - led.length > 0 ? ['Describe what you led in each leadership record.'] : []), ...(!outcome ? ['Add the outcome of at least one leadership role.'] : [])] });
    }
  }

  // 6 Extracurriculars
  {
    const rule = 'Starts at 1. Adds 1 for each distinct organization (max 2), 1 if any involvement lasted at least 24 months, and 1 if any record states a social impact or an award. Capped at 5.';
    if (!inp.leadership.length) out.push(insufficient('extracurriculars', 'Extracurriculars', rule, 'No leadership and extracurricular records.', ['Add community, volunteer or club involvement.']));
    else {
      const orgs = new Set(inp.leadership.map((l) => l.organization.trim().toLowerCase())).size;
      const long = inp.leadership.filter((l) => monthsBetween(l.start_date, l.end_date, now) >= 24);
      const impact = inp.leadership.some((l) => filled(l.social_impact) || filled(l.awards));
      const score = clamp(1 + Math.min(2, orgs) + (long.length ? 1 : 0) + (impact ? 1 : 0));
      out.push({ key: 'extracurriculars', label: 'Extracurriculars', score, confidence: orgs >= 3 ? 'high' : orgs === 2 ? 'medium' : 'low', rule,
        evidence: inp.leadership.map((l) => `${l.organization}${l.role ? `, ${l.role}` : ''}${l.start_date ? ` (${l.start_date} to ${l.end_date ?? 'present'})` : ''}`),
        expectations: ['No sourced school data.'], weaknesses: [...(!long.length ? ['No involvement with a recorded duration of 24 months or more.'] : []), ...(!impact ? ['No social impact or award recorded.'] : [])],
        improvements: [...(orgs < 2 ? ['Add other activities if you have them, with dates.'] : []), ...(!impact ? ['State the impact of your involvement.'] : [])] });
    }
  }

  // 7 International exposure
  {
    const rule = 'Counts distinct countries among your nationality, current country and education countries (d). Starts at 1, adds min(3, d - 1), and adds 1 if your work records show at least 2 distinct locations. Capped at 5. Work locations are free text so they are only counted as distinct strings.';
    const c = new Map<string, string>(); const addC = (v?: string | null) => { if (filled(v)) c.set(v!.trim().toLowerCase(), v!.trim()); };
    addC(inp.profile?.nationality); addC(inp.profile?.current_country); inp.education.forEach((e) => addC(e.country));
    const locs = new Set(inp.work.map((w) => (w.location ?? '').trim().toLowerCase()).filter(Boolean));
    if (!c.size) out.push(insufficient('international', 'International exposure', rule, 'No nationality, country or education country recorded.', ['Add nationality, current country and the country of each education record.']));
    else {
      const score = clamp(1 + Math.min(3, c.size - 1) + (locs.size >= 2 ? 1 : 0));
      out.push({ key: 'international', label: 'International exposure', score, confidence: c.size >= 3 && inp.work.length ? 'high' : c.size >= 2 ? 'medium' : 'low', rule,
        evidence: [`Countries recorded: ${[...c.values()].join(', ')}`, `${locs.size} distinct work location(s) recorded`], expectations: expectations(sd, ['international_pct'], now),
        weaknesses: c.size === 1 ? ['Only one country appears in your records.'] : [], improvements: [...(!locs.size ? ['Add locations to your work records.'] : []), 'Describe cross-border projects or teams in your work records if relevant.'] });
    }
  }

  // 8 Career clarity
  {
    const rule = 'Counts how many of 9 career objective fields are filled: why MBA, why now, short-term goal, long-term goal, industry, function, geography, transition, and target companies. Score 5 for 9, 4 for 7 to 8, 3 for 5 to 6, 2 for 3 to 4, 1 for 1 to 2. This measures completeness of your plan, not its quality.';
    const g = inp.goals; const keys: (keyof GoalsRow)[] = ['why_mba', 'why_now', 'short_term_goal', 'long_term_goal', 'target_industry', 'target_function', 'target_geography', 'career_transition', 'target_companies'];
    const n = g ? keys.filter((k) => filled(g[k])).length : 0;
    if (!g || n === 0) out.push(insufficient('clarity', 'Career clarity', rule, 'No career objectives recorded.', ['Complete the Career objectives section.']));
    else {
      const score = n >= 9 ? 5 : n >= 7 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : 1;
      const ind = (g.target_industry ?? '').toLowerCase(); const link = ind && inp.work.some((w) => filled(w.industry) && (ind.includes(w.industry!.toLowerCase()) || w.industry!.toLowerCase().includes(ind)));
      out.push({ key: 'clarity', label: 'Career clarity', score, confidence: n >= 7 ? 'high' : n >= 4 ? 'medium' : 'low', rule,
        evidence: [`${n} of 9 objective fields filled`, link ? 'Target industry matches an industry on your work records.' : 'No direct match between target industry and your work industries was found.'],
        expectations: ['No sourced school data. Schools expect a coherent, specific plan.'], weaknesses: keys.filter((k) => !filled(g[k])).map((k) => `Missing: ${String(k).replace(/_/g, ' ')}`),
        improvements: [...(g.career_transition ? [] : ['Explain how you move from your current field to your target.'])] });
    }
  }

  // 9 Personal differentiation
  {
    const rule = 'Starts at 1. Adds 3 if at least 6 of 7 narrative sections have 20 or more words, 2 if at least 4, 1 if at least 2. Adds 1 if you have at least 3 achievements with a quantified impact. Capped at 5. It measures how much distinctive material you have written down, not how distinctive it is.';
    const nar = inp.profile?.personal_narrative ?? {}; const nOk = NARRATIVE_KEYS.filter((k) => words(nar[k]) >= 20).length;
    const q = inp.achievements.filter((a) => filled(a.quantified_impact)).length;
    if (!NARRATIVE_KEYS.some((k) => filled(nar[k])) && !inp.achievements.length) out.push(insufficient('differentiation', 'Personal differentiation', rule, 'No personal narrative and no achievements.', ['Write your personal narrative and add achievements.']));
    else {
      const score = clamp(1 + (nOk >= 6 ? 3 : nOk >= 4 ? 2 : nOk >= 2 ? 1 : 0) + (q >= 3 ? 1 : 0));
      out.push({ key: 'differentiation', label: 'Personal differentiation', score, confidence: NARRATIVE_KEYS.filter((k) => filled(nar[k])).length >= 5 ? 'medium' : 'low', rule,
        evidence: [`${nOk} of 7 narrative sections have 20 or more words`, `${inp.achievements.length} achievement(s), ${q} with quantified impact`], expectations: ['No sourced school data.'],
        weaknesses: [...(nOk < 4 ? ['Several narrative sections are short or empty.'] : []), ...(q < 3 ? ['Fewer than 3 achievements with quantified impact.'] : [])],
        improvements: [...NARRATIVE_KEYS.filter((k) => words(nar[k]) < 20).map((k) => `Expand "${k.replace(/_/g, ' ')}" to at least 20 words.`).slice(0, 3), ...(q < 3 ? ['Quantify the impact of your achievements.'] : [])] });
    }
  }
  return out;
}

// ---------- undergrad ----------
/** Score bands per test, ascending cut points for 2..5. Rough, published-range based, not school requirements. */
const ENGLISH_CUTS: Partial<Record<TestType, number[]>> = { IELTS: [6, 6.5, 7, 7.5], TOEFL: [79, 90, 100, 110], PTE: [50, 58, 65, 73], DUOLINGO: [105, 115, 125, 135] };
const SAT_CUTS: Partial<Record<TestType, number[]>> = { SAT: [1200, 1300, 1400, 1500], ACT: [25, 28, 31, 34] };
const LATER_ESSAY = ['revision', 'final_review', 'approved', 'submitted'];
const AGREED = ['agreed', 'briefing_sent', 'in_progress', 'submitted'];

function bestBanded(inp: AssessInput, types: TestType[], cuts: Partial<Record<TestType, number[]>>, now: Date) {
  const l = latestValidScores(inp.tests, now).filter((x) => types.includes(x.type));
  const scored = l.map((x) => x.latestValid).filter((t): t is TestRow => !!t && t.overall != null).map((t) => ({ t, score: bands(t.overall!, cuts[t.test_type]!) }));
  const best = scored.reduce<{ t: TestRow; score: number } | null>((a, c) => (!a || c.score > a.score ? c : a), null);
  return { l, scored, best, planned: l.flatMap((x) => x.planned) };
}

/**
 * Undergrad dimensions: school grades, English test, SAT/ACT (optional), activities, essays and recommendations.
 * No GMAT, work experience or career progression.
 */
export function assessUndergrad(inp: AssessInput): Dimension[] {
  const now = inp.now ?? new Date(); const out: Dimension[] = [];

  // 1 School grades
  {
    const rule = 'Uses your best grade average divided by its scale (for example a rapor average of 88 out of 100 is 88%). Score 5 if at least 90%, 4 if at least 80%, 3 if at least 70%, 2 if at least 60%, otherwise 1. Grading differs between schools and countries, so treat this as a rough signal.';
    const recs = inp.education.filter((e) => e.gpa != null && e.gpa_scale);
    if (!recs.length) out.push(insufficient('grades', 'School grades', rule, 'No education record has a grade average and scale yet.', ['Add your school and your rapor average (scale 100), or your GPA.']));
    else {
      const best = recs.reduce((a, b) => (b.gpa! / b.gpa_scale! > a.gpa! / a.gpa_scale! ? b : a));
      const ratio = best.gpa! / best.gpa_scale!; const score = bands(ratio, [0.6, 0.7, 0.8, 0.9]);
      out.push({ key: 'grades', label: 'School grades', score, confidence: recs.length > 1 || best.honors ? 'medium' : 'low', rule,
        evidence: inp.education.map((e) => `${e.institution}${e.gpa != null && e.gpa_scale ? `: ${e.gpa} out of ${e.gpa_scale}` : ': no grade average yet'}`),
        expectations: expectations(inp.schoolData, ['avg_gpa'], now),
        weaknesses: score <= 2 ? [`Your best average is ${(ratio * 100).toFixed(0)}% of the scale, in the lower bands of this rule.`] : [],
        improvements: [...(!best.honors ? ['Add class rank, awards or olympiad results if you have them.'] : []), 'Keep your grades steady through Grade 12. Universities see your final results.'] });
    }
  }

  // 2 English test
  {
    const rule = 'Takes your best valid English test (IELTS, TOEFL, PTE or Duolingo, each valid 2 years). Bands for 2 to 5: IELTS 6, 6.5, 7, 7.5; TOEFL 79, 90, 100, 110; PTE 50, 58, 65, 73; Duolingo 105, 115, 125, 135. Below the first band scores 1. Always check each university\'s own minimum.';
    const { l, scored, best, planned } = bestBanded(inp, ENGLISH_TESTS, ENGLISH_CUTS, now);
    if (!best) {
      const reason = planned.length ? `Your ${TEST_LABEL[planned[0].test_type]} is planned${planned[0].test_date ? ` for ${fmtMonthYear(planned[0].test_date)}` : ''}. Add the score once you have it.`
        : l.some((x) => x.expired.length) ? 'Your English test score is older than 2 years.' : 'No English test score yet.';
      out.push(insufficient('english', 'English test', rule, reason, planned.length ? ['Book a practice test a few weeks before the real one.'] : ['Plan an IELTS, TOEFL, PTE or Duolingo test. You can add it as "Planned" with a target date.']));
    } else {
      out.push({ key: 'english', label: 'English test', score: best.score, confidence: 'high', rule,
        evidence: scored.map(({ t }) => `${TEST_LABEL[t.test_type]} ${t.overall}${t.test_date ? ` on ${t.test_date}` : ''}`), expectations: expectations(inp.schoolData, ['english_requirement'], now),
        weaknesses: best.score <= 2 ? ['This score may be below the minimum at some universities.'] : [], improvements: best.score <= 3 ? ['A retake could open more options. Check each university\'s minimum.'] : [] });
    }
  }

  // 3 SAT / ACT (optional)
  {
    const rule = 'Optional. Takes your best SAT total or ACT composite. Bands for 2 to 5: SAT 1200, 1300, 1400, 1500; ACT 25, 28, 31, 34. Many universities are test-optional, and universities outside the US rarely ask for it.';
    const { best, scored, planned } = bestBanded(inp, UNDERGRAD_TESTS, SAT_CUTS, now);
    if (!best) out.push({ ...insufficient('sat', 'SAT or ACT (optional)', rule, planned.length ? `Your ${TEST_LABEL[planned[0].test_type]} is planned. Add the score once you have it.` : 'Optional. Many universities are test-optional. Add a SAT or ACT score only if you take one.', ['Check whether your US universities want a SAT or ACT score.']), optional: true });
    else out.push({ key: 'sat', label: 'SAT or ACT (optional)', score: best.score, confidence: 'high', rule, optional: true,
      evidence: scored.map(({ t }) => `${TEST_LABEL[t.test_type]} ${t.overall}`), expectations: ['No sourced school data. Check each university for its SAT policy.'],
      weaknesses: [], improvements: best.score <= 2 ? ['If a university is test-optional, you can choose not to send a lower score.'] : [] });
  }

  // 4 Activities and leadership
  {
    const rule = 'Starts at 1. Adds 1 for each distinct activity (max 2), 1 if any activity lasted at least 12 months, and 1 if any activity or achievement states an outcome, award or impact. Capped at 5.';
    if (!inp.leadership.length && !inp.achievements.length) out.push(insufficient('activities', 'Activities and leadership', rule, 'No activities or achievements yet.', ['Add clubs, OSIS, sports, competitions, volunteering, music or a part-time job.']));
    else {
      const orgs = new Set(inp.leadership.map((l) => l.organization.trim().toLowerCase())).size;
      const long = inp.leadership.filter((l) => monthsBetween(l.start_date, l.end_date, now) >= 12);
      const impact = inp.leadership.some((l) => filled(l.achievements) || filled(l.social_impact) || filled(l.awards)) || inp.achievements.some((a) => filled(a.quantified_impact) || filled(a.description));
      const score = clamp(1 + Math.min(2, orgs) + (long.length ? 1 : 0) + (impact ? 1 : 0));
      out.push({ key: 'activities', label: 'Activities and leadership', score, confidence: orgs >= 3 ? 'high' : orgs >= 1 ? 'medium' : 'low', rule,
        evidence: [...inp.leadership.map((l) => `${l.organization}${l.role ? `, ${l.role}` : ''}`), ...inp.achievements.map((a) => `Achievement: ${a.title}`)],
        expectations: ['No sourced school data. Universities look for depth and commitment more than a long list.'],
        weaknesses: [...(!long.length ? ['No activity with a duration of 12 months or more recorded.'] : []), ...(!impact ? ['No outcome, award or impact recorded.'] : [])],
        improvements: [...(orgs < 2 ? ['Add other activities if you have them, with dates.'] : []), ...(!impact ? ['Say what changed because of your involvement.'] : [])] });
    }
  }

  // 5 Essays
  {
    const rule = 'Starts at 1. Adds 1 if you have started an essay, 1 if any draft has 250 or more words, 1 if any essay is in revision or later, and 1 if at least 3 personal narrative sections have 20 or more words. Capped at 5. It measures progress, not quality.';
    const es = inp.essays ?? []; const nar = inp.profile?.personal_narrative ?? {}; const nOk = NARRATIVE_KEYS.filter((k) => words(nar[k]) >= 20).length;
    if (!es.length && !nOk) out.push(insufficient('essays', 'Essays', rule, 'No essay or personal statement started yet.', ['Start your personal statement. A messy first draft is perfect.']));
    else {
      const drafted = es.some((e) => e.words > 0); const long = es.some((e) => e.words >= 250); const later = es.some((e) => LATER_ESSAY.includes(e.status));
      const score = clamp(1 + (drafted ? 1 : 0) + (long ? 1 : 0) + (later ? 1 : 0) + (nOk >= 3 ? 1 : 0));
      out.push({ key: 'essays', label: 'Essays', score, confidence: es.length ? 'medium' : 'low', rule,
        evidence: [`${es.length} essay(s), longest draft ${Math.max(0, ...es.map((e) => e.words))} words`, `${nOk} of 7 narrative sections have 20 or more words`],
        expectations: ['No sourced school data. Check each university\'s prompt and word limit.'],
        weaknesses: [...(!long ? ['No draft has reached 250 words yet.'] : []), ...(!later ? ['No essay has been revised yet.'] : [])],
        improvements: [...(!drafted ? ['Write a first draft, even a short one.'] : []), ...(!later ? ['Ask a teacher or friend to read a draft, then revise it.'] : [])] });
    }
  }

  // 6 Recommendations
  {
    const rule = 'Starts at 1. Adds 1 for each recommender (max 2), 1 if any recommender has agreed or is writing, and 1 if any letter is submitted. Capped at 5.';
    const rs = inp.recommenders ?? [];
    if (!rs.length) out.push(insufficient('recommendations', 'Recommendations', rule, 'No teacher or counselor added yet.', ['Add a teacher or counselor who knows you well.']));
    else {
      const agreed = rs.some((r) => r.statuses.some((s) => AGREED.includes(s))); const sub = rs.some((r) => r.statuses.includes('submitted'));
      const score = clamp(1 + Math.min(2, rs.length) + (agreed ? 1 : 0) + (sub ? 1 : 0));
      out.push({ key: 'recommendations', label: 'Recommendations', score, confidence: 'medium', rule,
        evidence: [`${rs.length} recommender(s)`, agreed ? 'At least one has agreed to write.' : 'No one has agreed yet.'],
        expectations: ['No sourced school data. Many universities ask for a counselor letter plus one or two teachers.'],
        weaknesses: [...(!agreed ? ['No recommender has agreed yet.'] : [])], improvements: [...(rs.length < 2 ? ['Add a second teacher, ideally in the subject you want to study.'] : []), ...(!agreed ? ['Ask early and give them a short note about you.'] : [])] });
    }
  }
  return out;
}
