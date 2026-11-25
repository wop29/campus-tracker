'use client';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { titleCase } from '@/lib/utils';
import { GMAT_VERSIONS, GPA_SCALES, NARRATIVE_KEYS, TEST_LABEL, defaultTestType, fmtDayMonthYear, fmtMonthYear, goalFields, latestValidScores, testExpiry, testStatus, testTypesFor, validateTestScore, type GoalsRow, type TestRow } from '@/lib/profile';
import { currentUserId, type ProfileData } from './data';
import { RecordCrud, SingleForm, rowToVals, type FDef, type Verification } from './forms';
import { AchievementSchema, EducationSchema, GoalsSchema, UndergradGoalsSchema, LeadershipSchema, NarrativeSchema, PersonalSchema, TestSchema, WorkSchema } from './schemas';

interface TabProps { data: ProfileData; ver: Verification; reload: () => Promise<void> }
const T = ({ children }: { children: ReactNode }) => <span className="text-sm text-secondary">{children}</span>;
const Line = ({ label, v }: { label: string; v?: string | number | null }) => (v == null || v === '' ? null : <p className="text-sm"><span className="text-secondary">{label}: </span>{v}</p>);
const range = (a?: string | null, b?: string | null) => (a || b ? `${a ? fmtMonthYear(a) : '?'} to ${b ? fmtMonthYear(b) : 'present'}` : null);
const YEAR = new Date().getFullYear();

// ---------- personal ----------
const PERSONAL: FDef[] = [
  { name: 'full_name', label: 'Full name', type: 'text', required: true }, { name: 'preferred_name', label: 'Preferred name', type: 'text' },
  { name: 'email', label: 'Email', type: 'email' }, { name: 'nationality', label: 'Nationality', type: 'text' },
  { name: 'current_country', label: 'Current country', type: 'text' }, { name: 'current_city', label: 'Current city', type: 'text' },
];
export function PersonalTab({ data, ver, reload }: TabProps) {
  return <SingleForm section="personal" title="Personal details" fields={PERSONAL} schema={PersonalSchema} ver={ver}
    initial={rowToVals(PERSONAL, data.profile as Record<string, unknown> | null)}
    save={async (payload) => { const sb = supabaseBrowser(); await must(sb.from('applicant_profiles').upsert({ user_id: await currentUserId(sb), ...payload }, { onConflict: 'user_id' }).select('id')); await reload(); }} />;
}

// ---------- education ----------
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));
const SCHOOL_LEVELS = ['SMA', 'SMK', 'MA (Madrasah Aliyah)', 'IB Diploma', 'Cambridge A Levels', 'Cambridge IGCSE', 'US High School Diploma', 'Paket C', 'Other'] as const;
const DEGREE_LEVELS = ["Diploma (D3/D4)", "Bachelor's (S1)", "Master's (S2)", 'Doctorate (S3)', 'Professional certificate', 'Other'] as const;
const SCHOOL_STREAMS = ['IPA (Science)', 'IPS (Social Studies)', 'Bahasa (Language)', 'Kurikulum Merdeka (no stream)', 'SMK vocational program', 'IB or A Level subjects', 'Other'] as const;
/** Indonesia first, then the most common places Indonesian students study, then Other. */
const EDU_COUNTRIES = ['Indonesia', 'Singapore', 'Malaysia', 'Australia', 'United States', 'United Kingdom', 'Canada', 'Netherlands', 'Germany', 'Japan', 'South Korea', 'China', 'Hong Kong', 'Taiwan', 'Thailand', 'Philippines', 'India', 'New Zealand', 'France', 'Other'] as const;
const STATUS_OPTS = [{ value: 'current', label: 'Currently studying' }, { value: 'completed', label: 'Completed' }, { value: 'incomplete', label: 'Did not finish' }];
const STATUS_TEXT: Record<string, string> = Object.fromEntries(STATUS_OPTS.map((o) => [o.value, o.label]));
function eduFields(track: ProfileData['track']): FDef[] {
  const ug = track === 'undergrad';
  return [
    { name: 'institution', label: ug ? 'School' : 'Institution', type: 'text', required: true, placeholder: ug ? 'e.g. SMA Negeri 3 Bandung' : undefined },
    { name: 'degree', label: ug ? 'Level' : 'Degree', type: 'select', options: opts(ug ? SCHOOL_LEVELS : DEGREE_LEVELS) },
    ug ? { name: 'major', label: 'Stream or focus', type: 'select', options: opts(SCHOOL_STREAMS) } : { name: 'major', label: 'Major / field', type: 'text', placeholder: 'e.g. Civil Engineering' },
    { name: 'country', label: 'Country', type: 'select', options: opts(EDU_COUNTRIES) },
    { name: 'enrollment_status', label: 'Status', type: 'select', required: true, options: STATUS_OPTS },
    { name: 'graduation_date', label: 'Graduation (or expected)', type: 'month', years: [YEAR - 40, YEAR + 8] },
    { name: 'gpa', label: ug ? 'Grade average' : 'GPA', type: 'number', step: '0.01', hint: ug ? 'Indonesian high school? Use your rapor average so far, for example 88.5.' : undefined },
    { name: 'gpa_scale', label: ug ? 'Out of' : 'GPA scale', type: 'select', asNumber: true, options: GPA_SCALES.map((g) => ({ value: String(g.value), label: g.label })), hint: ug ? 'Rapor averages are out of 100. A university GPA (IPK) is out of 4.0.' : 'The maximum possible GPA. An Indonesian IPK is out of 4.0.' },
    { name: 'honors', label: ug ? 'Class rank or honors' : 'Honors', type: 'text' }, { name: 'additional_qualifications', label: 'Additional qualifications', type: 'textarea' },
  ];
}
export function EducationTab({ data, ver, reload }: TabProps) {
  const ug = data.track === 'undergrad';
  return <RecordCrud table="education_records" section="education" title="Education" noun="Education" rows={data.education} fields={eduFields(data.track)} schema={EducationSchema} ver={ver} reload={reload}
    initial={ug ? { enrollment_status: 'current', gpa_scale: '100', country: 'Indonesia' } : { enrollment_status: 'completed', gpa_scale: '4', country: 'Indonesia' }}
    emptyHint={ug ? 'Start with your high school. Your rapor average is enough for now.' : 'Add each degree or program you attended, including incomplete or current ones.'}
    summary={(r) => (<div className="space-y-0.5"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.institution}</span><Badge tone={r.enrollment_status === 'completed' ? 'success' : 'neutral'}>{STATUS_TEXT[r.enrollment_status] ?? titleCase(r.enrollment_status)}</Badge></div>
      <T>{[r.degree, r.major, r.country].filter(Boolean).join(', ') || (ug ? 'No level or stream yet' : 'No degree details yet')}</T>
      <Line label={ug ? 'Grade average' : 'GPA'} v={r.gpa != null ? `${r.gpa}${r.gpa_scale ? ` out of ${r.gpa_scale}` : ''}` : null} /><Line label="Graduation" v={r.graduation_date ? fmtMonthYear(r.graduation_date) : null} /><Line label="Honors" v={r.honors} /></div>)} />;
}

// ---------- tests ----------
type V = Record<string, string>;
const is = (...types: string[]) => (v: V) => types.includes(v.test_type);
const taken = (v: V) => v.status !== 'planned';
const both = (a: (v: V) => boolean) => (v: V) => taken(v) && a(v);
const OVERALL: [string[], string, string][] = [
  [['GMAT'], 'Total score', 'GMAT total'], [['SAT'], 'Total (400 to 1600)', ''], [['ACT'], 'Composite (1 to 36)', ''], [['IELTS'], 'Overall band (0 to 9)', ''],
  [['TOEFL'], 'Total (0 to 120)', ''], [['PTE'], 'Overall (10 to 90)', ''], [['DUOLINGO'], 'Overall (10 to 160)', ''], [['OTHER'], 'Overall score', ''],
];
function testFields(track: ProfileData['track'], program: ProfileData['program']): FDef[] {
  return [
    { name: 'test_type', label: 'Test', type: 'select', required: true, resets: ['exam_version'], options: testTypesFor(track, program).map((t) => ({ value: t, label: TEST_LABEL[t] })) },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'taken', label: 'Taken, I have a score' }, { value: 'planned', label: 'Planned, not taken yet' }] },
    { name: 'exam_version', label: 'Version', type: 'select', options: GMAT_VERSIONS.map((v) => ({ value: v, label: v })), showWhen: both(is('GMAT')) },
    { name: 'exam_version', label: 'Version or module', type: 'text', placeholder: 'e.g. Academic, iBT', showWhen: is('IELTS', 'TOEFL', 'PTE', 'OTHER') },
    ...OVERALL.map(([types, label]) => ({ name: 'overall', label, type: 'number' as const, step: types[0] === 'IELTS' ? '0.5' : 'any', showWhen: both(is(...types)) })),
    { name: 'verbal', label: 'Reading and Writing', type: 'number', showWhen: both(is('SAT')) }, { name: 'quant', label: 'Math', type: 'number', showWhen: both(is('SAT')) },
    { name: 'quant', label: 'Quantitative', type: 'number', showWhen: both(is('GMAT', 'GRE')) }, { name: 'verbal', label: 'Verbal', type: 'number', showWhen: both(is('GMAT', 'GRE')) },
    { name: 'data_insights', label: 'Data Insights', type: 'number', showWhen: (v) => taken(v) && v.test_type === 'GMAT' && v.exam_version !== 'Classic (10th Edition)' },
    { name: 'analytical_writing', label: 'Analytical Writing', type: 'number', step: '0.5', showWhen: (v) => taken(v) && (v.test_type === 'GRE' || (v.test_type === 'GMAT' && v.exam_version === 'Classic (10th Edition)')) },
    { name: 'test_date', label: 'Test date', type: 'date', required: true, years: [YEAR - 12, YEAR], showWhen: taken },
    { name: 'test_date', label: 'Target month (optional)', type: 'month', years: [YEAR, YEAR + 3], hint: 'Not booked yet? Leave it empty.', showWhen: (v) => !taken(v) },
    { name: 'attempt_number', label: 'Attempt number', type: 'number', step: '1' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}
const scoreLine = (t: TestRow) => {
  const L = t.test_type === 'SAT' ? { q: 'Math', v: 'Reading and Writing' } : { q: 'Quant', v: 'Verbal' };
  return [t.overall != null && `Overall ${t.overall}`, t.quant != null && `${L.q} ${t.quant}`, t.verbal != null && `${L.v} ${t.verbal}`, t.data_insights != null && `DI ${t.data_insights}`, t.analytical_writing != null && `AW ${t.analytical_writing}`].filter(Boolean).join(', ');
};
export function TestsTab({ data, ver, reload }: TabProps) {
  const now = new Date(); const latest = latestValidScores(data.tests, now).filter((l) => l.latestValid || l.expired.length || l.undated.length);
  const ug = data.track === 'undergrad'; const first = defaultTestType(data.track, data.program);
  return <RecordCrud table="test_scores" section="tests" title={ug ? 'Tests' : data.program === 'mba' ? 'Standardized tests' : 'Tests'} noun="Test" rows={data.tests} fields={testFields(data.track, data.program)} schema={TestSchema} ver={ver} reload={reload}
    initial={{ test_type: first, status: 'taken', exam_version: first === 'GMAT' ? 'Focus Edition' : '', attempt_number: '1' }}
    emptyHint={ug ? 'Add your IELTS, TOEFL, PTE or Duolingo score, or the test you plan to take. SAT or ACT only if your universities ask for it.' : 'Add your test results, or a test you plan to take. Validity is worked out from the test date.'}
    extraValidate={(p) => ({ ...validateTestScore(p as Partial<TestRow>), ...(p.test_type === 'GMAT' && p.status !== 'planned' && !p.exam_version ? { exam_version: 'Choose the GMAT version so ranges can be checked' } : {}) })}
    intro={latest.length > 0 && (
      <Card className="space-y-2"><h3 className="text-sm font-medium">Latest valid score per test</h3>
        <p className="text-xs text-secondary">English tests (IELTS, TOEFL, PTE, Duolingo) stay valid 2 years and GMAT and GRE 5 years, counted from the test date. SAT and ACT scores do not expire, but some universities prefer recent ones.</p>
        <ul className="grid gap-2 sm:grid-cols-2">{latest.map((l) => (
          <li key={l.type} className="rounded-md border bg-white p-2 text-sm"><div className="flex items-center gap-2"><b>{TEST_LABEL[l.type]}</b>{l.latestValid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">No valid score</Badge>}</div>
            {l.latestValid ? <p className="text-secondary">{scoreLine(l.latestValid)}{l.latestValid.test_date ? `, taken ${fmtDayMonthYear(l.latestValid.test_date)}` : ''}{testExpiry(l.latestValid) ? `, valid until ${fmtDayMonthYear(testExpiry(l.latestValid))}` : ''}</p>
              : <p className="text-secondary">{l.expired.length ? 'All recorded scores have expired.' : 'Records have no scores or no test date.'}</p>}</li>))}</ul></Card>)}
    summary={(r) => { const st = testStatus(r, now); const exp = testExpiry(r); return (
      <div className="space-y-0.5"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{TEST_LABEL[r.test_type] ?? r.test_type}{r.exam_version ? ` (${r.exam_version})` : ''}</span><T>attempt {r.attempt_number ?? 1}</T>
        {st === 'planned' && <Badge tone="accent">Planned</Badge>}{st === 'expired' && <Badge tone="danger">Expired</Badge>}{st === 'valid' && <Badge tone="success">Valid</Badge>}{st === 'undated' && <Badge tone="warning">No date</Badge>}</div>
        {st === 'planned' ? <T>{r.test_date ? `Target: ${fmtMonthYear(r.test_date)}` : 'No target date yet. That is fine.'}</T> : <>
          <T>{scoreLine(r) || 'No scores'}</T><Line label="Taken" v={r.test_date ? fmtDayMonthYear(r.test_date) : null} /><Line label={st === 'expired' ? 'Expired on' : 'Valid until'} v={exp ? fmtDayMonthYear(exp) : null} /></>}</div>); }} />;
}

// ---------- work ----------
const WORK: FDef[] = [
  { name: 'company', label: 'Company', type: 'text', required: true }, { name: 'position', label: 'Position', type: 'text', required: true },
  { name: 'industry', label: 'Industry', type: 'text' }, { name: 'location', label: 'Location', type: 'text' },
  { name: 'start_date', label: 'Start', type: 'month' }, { name: 'end_date', label: 'End', type: 'month', hint: 'Leave empty if this is your current role' },
  { name: 'employment_type', label: 'Employment type', type: 'text', placeholder: 'e.g. Full-time' }, { name: 'team_size', label: 'Team size managed', type: 'number', step: '1' },
  { name: 'budget_ownership', label: 'Budget ownership', type: 'text', hint: 'What budget you owned or influenced, in your own words' },
  { name: 'description', label: 'Role description', type: 'textarea' }, { name: 'responsibilities', label: 'Responsibilities', type: 'textarea' },
  { name: 'achievements', label: 'Achievements', type: 'textarea' }, { name: 'promotions', label: 'Promotions', type: 'textarea' },
  { name: 'measurable_impact', label: 'Measurable impact', type: 'textarea', hint: 'Numbers and outcomes you can back up' },
];
export function WorkTab({ data, ver, reload }: TabProps) {
  return <RecordCrud table="work_experiences" section="work" title="Work experience" noun="Role" rows={data.work} fields={WORK} schema={WorkSchema} ver={ver} reload={reload} emptyHint="Add each role with dates, scope and measurable impact."
    summary={(r) => (<div className="space-y-0.5"><span className="font-medium">{r.position}</span> <T>at {r.company}</T><div><T>{[r.industry, r.location, range(r.start_date, r.end_date)].filter(Boolean).join(' | ')}</T></div>
      <Line label="Team size" v={r.team_size} /><Line label="Budget" v={r.budget_ownership} /><Line label="Promotions" v={r.promotions} /><Line label="Impact" v={r.measurable_impact} /></div>)} />;
}

// ---------- leadership ----------
const LEAD: FDef[] = [
  { name: 'organization', label: 'Organization', type: 'text', required: true }, { name: 'role', label: 'Role', type: 'text' },
  { name: 'start_date', label: 'Start', type: 'month' }, { name: 'end_date', label: 'End', type: 'month', hint: 'Leave empty if ongoing' },
  { name: 'responsibilities', label: 'Responsibilities', type: 'textarea' }, { name: 'leadership_experience', label: 'What you led', type: 'textarea' },
  { name: 'achievements', label: 'Achievements', type: 'textarea' }, { name: 'social_impact', label: 'Social impact', type: 'textarea' }, { name: 'awards', label: 'Awards', type: 'text' },
];
export function LeadershipTab({ data, ver, reload }: TabProps) {
  return <RecordCrud table="leadership_experiences" section="leadership" title="Leadership and extracurriculars" noun="Activity" rows={data.leadership} fields={LEAD} schema={LeadershipSchema} ver={ver} reload={reload} emptyHint="Add clubs, community work, volunteering or leadership outside your job."
    summary={(r) => (<div className="space-y-0.5"><span className="font-medium">{r.organization}</span>{r.role && <T> , {r.role}</T>}<div><T>{range(r.start_date, r.end_date)}</T></div><Line label="Led" v={r.leadership_experience} /><Line label="Achievements" v={r.achievements} /><Line label="Impact" v={r.social_impact} /><Line label="Awards" v={r.awards} /></div>)} />;
}

// ---------- achievements ----------
const ACH: FDef[] = [
  { name: 'title', label: 'Title', type: 'text', required: true }, { name: 'achieved_on', label: 'When', type: 'month' },
  { name: 'description', label: 'Description', type: 'textarea' }, { name: 'quantified_impact', label: 'Quantified impact', type: 'text', hint: 'For example a percentage, amount or count you can verify' },
];
export function AchievementsTab({ data, ver, reload }: TabProps) {
  return <RecordCrud table="achievements" section="achievements" title="Achievements" noun="Achievement" rows={data.achievements} fields={ACH} schema={AchievementSchema} ver={ver} reload={reload} emptyHint="Add awards, results and milestones you could use in essays and interviews."
    summary={(r) => (<div className="space-y-0.5"><span className="font-medium">{r.title}</span>{r.achieved_on && <T> , {fmtMonthYear(r.achieved_on)}</T>}<Line label="Impact" v={r.quantified_impact} /><Line label="Details" v={r.description} /></div>)} />;
}

// ---------- goals ----------
function goalsFields(track: ProfileData['track'], program: ProfileData['program']): FDef[] {
  if (track === 'undergrad') {
    const hints: Partial<Record<keyof GoalsRow, string>> = {
      why_mba: 'For example computer science or business, and what pulls you toward it. Not sure yet? Write what you enjoy.',
      short_term_goal: 'Topics, problems or projects you keep coming back to, in or out of school.',
      long_term_goal: 'A few possibilities are fine. You do not need a fixed plan.',
    };
    return goalFields('undergrad').map(([k, label]) => ({ name: k, label, type: 'textarea' as const, hint: hints[k] }));
  }
  const nonMba = program === 'masters' || program === 'phd';
  return [
    { name: 'why_mba', label: nonMba ? 'Why this degree' : 'Why an MBA', type: 'textarea' }, { name: 'why_now', label: 'Why now', type: 'textarea' },
    { name: 'short_term_goal', label: 'Short-term goal', type: 'textarea' }, { name: 'long_term_goal', label: 'Long-term goal', type: 'textarea' },
    { name: 'target_industry', label: nonMba ? 'Target field or industry' : 'Target industry', type: 'text', hint: 'Separate several with commas' }, { name: 'target_function', label: nonMba ? 'Target role or research area' : 'Target function', type: 'text', hint: 'Separate several with commas' },
    { name: 'target_geography', label: 'Target geography', type: 'text' }, { name: 'career_transition', label: nonMba ? 'How this degree connects your past and your goals' : 'Career transition', type: 'textarea', hint: nonMba ? undefined : 'How you move from your current field to the target' },
    { name: 'target_companies', label: nonMba ? 'Target employers, labs or supervisors' : 'Target companies', type: 'list', hint: 'One per line or separated by commas' },
  ];
}
export function GoalsTab({ data, ver, reload }: TabProps) {
  const fields = goalsFields(data.track, data.program); const ug = data.track === 'undergrad';
  return <SingleForm key={data.track} section="goals" title={ug ? 'Study goals' : data.program === 'mba' || !data.program ? 'Career objectives' : 'Goals for this degree'} fields={fields} schema={ug ? UndergradGoalsSchema : GoalsSchema} ver={ver} initial={rowToVals(fields, data.goals as Record<string, unknown> | null)}
    intro={ug ? <p className="text-sm text-secondary">Rough notes are perfect. These become ideas for your personal statement later.</p> : undefined}
    save={async (payload) => { const sb = supabaseBrowser(); await must(sb.from('career_goals').upsert({ user_id: await currentUserId(sb), ...payload }, { onConflict: 'user_id' }).select('id')); await reload(); }} />;
}

// ---------- narrative ----------
const NARR: FDef[] = NARRATIVE_KEYS.map((k) => ({ name: k, label: titleCase(k), type: 'textarea' as const }));
export function NarrativeTab({ data, ver, reload }: TabProps) {
  return <SingleForm section="narrative" title="Personal narrative" fields={NARR} schema={NarrativeSchema} ver={ver} initial={rowToVals(NARR, (data.profile?.personal_narrative ?? null) as Record<string, unknown> | null)}
    intro={<p className="text-sm text-secondary">Raw material for your essays, written in your own words. Nothing here is shared or generated.</p>}
    save={async (payload) => { const sb = supabaseBrowser(); await must(sb.from('applicant_profiles').upsert({ user_id: await currentUserId(sb), personal_narrative: Object.fromEntries(Object.entries(payload).filter(([, v]) => v)) }, { onConflict: 'user_id' }).select('id')); await reload(); }} />;
}
