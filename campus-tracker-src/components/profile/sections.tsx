'use client';
import type { ReactNode } from 'react';
import { Badge, Card } from '@/components/ui';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { fmtDate, titleCase } from '@/lib/utils';
import { GMAT_VERSIONS, NARRATIVE_KEYS, TEST_TYPES, TEST_VALIDITY_YEARS, latestValidScores, testExpiry, testStatus, validateTestScore, type TestRow } from '@/lib/profile';
import { currentUserId, type ProfileData } from './data';
import { RecordCrud, SingleForm, rowToVals, type FDef, type Verification } from './forms';
import { AchievementSchema, EducationSchema, GoalsSchema, LeadershipSchema, NarrativeSchema, PersonalSchema, TestSchema, WorkSchema } from './schemas';

interface TabProps { data: ProfileData; ver: Verification; reload: () => Promise<void> }
const T = ({ children }: { children: ReactNode }) => <span className="text-sm text-secondary">{children}</span>;
const Line = ({ label, v }: { label: string; v?: string | number | null }) => (v == null || v === '' ? null : <p className="text-sm"><span className="text-secondary">{label}: </span>{v}</p>);
const range = (a?: string | null, b?: string | null) => (a || b ? `${a ? fmtDate(a) : '?'} to ${b ? fmtDate(b) : 'present'}` : null);

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
const EDU: FDef[] = [
  { name: 'institution', label: 'Institution', type: 'text', required: true }, { name: 'degree', label: 'Degree', type: 'text', placeholder: 'e.g. Bachelor of Science' },
  { name: 'major', label: 'Major / field', type: 'text' }, { name: 'country', label: 'Country', type: 'text' },
  { name: 'enrollment_status', label: 'Status', type: 'select', required: true, options: [{ value: 'completed', label: 'Completed' }, { value: 'current', label: 'Current' }, { value: 'incomplete', label: 'Incomplete' }] },
  { name: 'graduation_date', label: 'Graduation date (or expected)', type: 'date' },
  { name: 'gpa', label: 'GPA', type: 'number', step: '0.01' }, { name: 'gpa_scale', label: 'GPA scale', type: 'number', step: '0.01', hint: 'The maximum possible GPA, for example 4.0' },
  { name: 'honors', label: 'Honors', type: 'text' }, { name: 'additional_qualifications', label: 'Additional qualifications', type: 'textarea' },
];
export function EducationTab({ data, ver, reload }: TabProps) {
  return <RecordCrud table="education_records" section="education" title="Education" noun="Education" rows={data.education} fields={EDU} schema={EducationSchema} ver={ver} reload={reload}
    initial={{ enrollment_status: 'completed' }} emptyHint="Add each degree or program you attended, including incomplete or current ones."
    summary={(r) => (<div className="space-y-0.5"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.institution}</span><Badge tone={r.enrollment_status === 'completed' ? 'success' : 'neutral'}>{titleCase(r.enrollment_status)}</Badge></div>
      <T>{[r.degree, r.major, r.country].filter(Boolean).join(', ') || 'No degree details yet'}</T>
      <Line label="GPA" v={r.gpa != null ? `${r.gpa}${r.gpa_scale ? ` / ${r.gpa_scale}` : ''}` : null} /><Line label="Graduation" v={r.graduation_date ? fmtDate(r.graduation_date) : null} /><Line label="Honors" v={r.honors} /></div>)} />;
}

// ---------- tests ----------
const isGmat = (v: Record<string, string>) => v.test_type === 'GMAT'; const isGre = (v: Record<string, string>) => v.test_type === 'GRE';
const TEST: FDef[] = [
  { name: 'test_type', label: 'Test', type: 'select', required: true, resets: ['exam_version'], options: TEST_TYPES.map((t) => ({ value: t, label: t })) },
  { name: 'exam_version', label: 'Version', type: 'select', options: GMAT_VERSIONS.map((v) => ({ value: v, label: v })), showWhen: isGmat },
  { name: 'exam_version', label: 'Version or module', type: 'text', placeholder: 'e.g. Academic, iBT', showWhen: (v) => !isGmat(v) && !isGre(v) },
  { name: 'overall', label: 'Total / overall score', type: 'number', showWhen: (v) => !isGre(v), hint: 'GMAT total, IELTS band or TOEFL total' },
  { name: 'quant', label: 'Quantitative', type: 'number', showWhen: (v) => isGmat(v) || isGre(v) }, { name: 'verbal', label: 'Verbal', type: 'number', showWhen: (v) => isGmat(v) || isGre(v) },
  { name: 'data_insights', label: 'Data Insights', type: 'number', showWhen: (v) => isGmat(v) && v.exam_version !== 'Classic (10th Edition)' },
  { name: 'analytical_writing', label: 'Analytical Writing', type: 'number', step: '0.5', showWhen: (v) => isGre(v) || (isGmat(v) && v.exam_version === 'Classic (10th Edition)') },
  { name: 'test_date', label: 'Test date', type: 'date', required: true }, { name: 'attempt_number', label: 'Attempt number', type: 'number', step: '1' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
const scoreLine = (t: TestRow) => [t.overall != null && `Overall ${t.overall}`, t.quant != null && `Quant ${t.quant}`, t.verbal != null && `Verbal ${t.verbal}`, t.data_insights != null && `DI ${t.data_insights}`, t.analytical_writing != null && `AW ${t.analytical_writing}`].filter(Boolean).join(', ');
export function TestsTab({ data, ver, reload }: TabProps) {
  const now = new Date(); const latest = latestValidScores(data.tests, now);
  return <RecordCrud table="test_scores" section="tests" title="Standardized tests" noun="Test score" rows={data.tests} fields={TEST} schema={TestSchema} ver={ver} reload={reload}
    initial={{ test_type: 'GMAT', exam_version: 'Focus Edition', attempt_number: '1' }} emptyHint="Add your GMAT, GRE and English test results. Validity is calculated from the test date."
    extraValidate={(p) => ({ ...validateTestScore(p as Partial<TestRow>), ...(p.test_type === 'GMAT' && !p.exam_version ? { exam_version: 'Choose the GMAT version so ranges can be checked' } : {}) })}
    intro={latest.length > 0 && (
      <Card className="space-y-2"><h3 className="text-sm font-medium">Latest valid score per test</h3>
        <p className="text-xs text-secondary">Validity: GMAT and GRE {TEST_VALIDITY_YEARS.GMAT} years, TOEFL and IELTS {TEST_VALIDITY_YEARS.TOEFL} years, counted from the test date.</p>
        <ul className="grid gap-2 sm:grid-cols-2">{latest.map((l) => (
          <li key={l.type} className="rounded-md border bg-white p-2 text-sm"><div className="flex items-center gap-2"><b>{l.type}</b>{l.latestValid ? <Badge tone="success">Valid</Badge> : <Badge tone="danger">No valid score</Badge>}</div>
            {l.latestValid ? <p className="text-secondary">{scoreLine(l.latestValid)}{l.latestValid.test_date ? `, taken ${fmtDate(l.latestValid.test_date)}` : ''}{testExpiry(l.latestValid) ? `, valid until ${fmtDate(testExpiry(l.latestValid))}` : ''}</p>
              : <p className="text-secondary">{l.expired.length ? 'All recorded scores have expired.' : 'Records have no scores or no test date.'}</p>}</li>))}</ul></Card>)}
    summary={(r) => { const st = testStatus(r, now); const exp = testExpiry(r); return (
      <div className="space-y-0.5"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{r.test_type}{r.exam_version ? ` (${r.exam_version})` : ''}</span><T>attempt {r.attempt_number ?? 1}</T>
        {st === 'expired' && <Badge tone="danger">Expired</Badge>}{st === 'valid' && <Badge tone="success">Valid</Badge>}{st === 'undated' && <Badge tone="warning">No date</Badge>}</div>
        <T>{scoreLine(r) || 'No scores'}</T><Line label="Taken" v={r.test_date ? fmtDate(r.test_date) : null} /><Line label={st === 'expired' ? 'Expired on' : 'Valid until'} v={exp ? fmtDate(exp) : null} /></div>); }} />;
}

// ---------- work ----------
const WORK: FDef[] = [
  { name: 'company', label: 'Company', type: 'text', required: true }, { name: 'position', label: 'Position', type: 'text', required: true },
  { name: 'industry', label: 'Industry', type: 'text' }, { name: 'location', label: 'Location', type: 'text' },
  { name: 'start_date', label: 'Start date', type: 'date' }, { name: 'end_date', label: 'End date', type: 'date', hint: 'Leave empty if this is your current role' },
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
  { name: 'start_date', label: 'Start date', type: 'date' }, { name: 'end_date', label: 'End date', type: 'date', hint: 'Leave empty if ongoing' },
  { name: 'responsibilities', label: 'Responsibilities', type: 'textarea' }, { name: 'leadership_experience', label: 'What you led', type: 'textarea' },
  { name: 'achievements', label: 'Achievements', type: 'textarea' }, { name: 'social_impact', label: 'Social impact', type: 'textarea' }, { name: 'awards', label: 'Awards', type: 'text' },
];
export function LeadershipTab({ data, ver, reload }: TabProps) {
  return <RecordCrud table="leadership_experiences" section="leadership" title="Leadership and extracurriculars" noun="Activity" rows={data.leadership} fields={LEAD} schema={LeadershipSchema} ver={ver} reload={reload} emptyHint="Add clubs, community work, volunteering or leadership outside your job."
    summary={(r) => (<div className="space-y-0.5"><span className="font-medium">{r.organization}</span>{r.role && <T> , {r.role}</T>}<div><T>{range(r.start_date, r.end_date)}</T></div><Line label="Led" v={r.leadership_experience} /><Line label="Achievements" v={r.achievements} /><Line label="Impact" v={r.social_impact} /><Line label="Awards" v={r.awards} /></div>)} />;
}

// ---------- achievements ----------
const ACH: FDef[] = [
  { name: 'title', label: 'Title', type: 'text', required: true }, { name: 'achieved_on', label: 'Date', type: 'date' },
  { name: 'description', label: 'Description', type: 'textarea' }, { name: 'quantified_impact', label: 'Quantified impact', type: 'text', hint: 'For example a percentage, amount or count you can verify' },
];
export function AchievementsTab({ data, ver, reload }: TabProps) {
  return <RecordCrud table="achievements" section="achievements" title="Achievements" noun="Achievement" rows={data.achievements} fields={ACH} schema={AchievementSchema} ver={ver} reload={reload} emptyHint="Add awards, results and milestones you could use in essays and interviews."
    summary={(r) => (<div className="space-y-0.5"><span className="font-medium">{r.title}</span>{r.achieved_on && <T> , {fmtDate(r.achieved_on)}</T>}<Line label="Impact" v={r.quantified_impact} /><Line label="Details" v={r.description} /></div>)} />;
}

// ---------- goals ----------
const GOALS: FDef[] = [
  { name: 'why_mba', label: 'Why an MBA', type: 'textarea' }, { name: 'why_now', label: 'Why now', type: 'textarea' },
  { name: 'short_term_goal', label: 'Short-term goal', type: 'textarea' }, { name: 'long_term_goal', label: 'Long-term goal', type: 'textarea' },
  { name: 'target_industry', label: 'Target industry', type: 'text', hint: 'Separate several with commas' }, { name: 'target_function', label: 'Target function', type: 'text', hint: 'Separate several with commas' },
  { name: 'target_geography', label: 'Target geography', type: 'text' }, { name: 'career_transition', label: 'Career transition', type: 'textarea', hint: 'How you move from your current field to the target' },
  { name: 'target_companies', label: 'Target companies', type: 'list', hint: 'One per line or separated by commas' },
];
export function GoalsTab({ data, ver, reload }: TabProps) {
  return <SingleForm section="goals" title="Career objectives" fields={GOALS} schema={GoalsSchema} ver={ver} initial={rowToVals(GOALS, data.goals as Record<string, unknown> | null)}
    save={async (payload) => { const sb = supabaseBrowser(); await must(sb.from('career_goals').upsert({ user_id: await currentUserId(sb), ...payload }, { onConflict: 'user_id' }).select('id')); await reload(); }} />;
}

// ---------- narrative ----------
const NARR: FDef[] = NARRATIVE_KEYS.map((k) => ({ name: k, label: titleCase(k), type: 'textarea' as const }));
export function NarrativeTab({ data, ver, reload }: TabProps) {
  return <SingleForm section="narrative" title="Personal narrative" fields={NARR} schema={NarrativeSchema} ver={ver} initial={rowToVals(NARR, (data.profile?.personal_narrative ?? null) as Record<string, unknown> | null)}
    intro={<p className="text-sm text-secondary">Raw material for your essays, written in your own words. Nothing here is shared or generated.</p>}
    save={async (payload) => { const sb = supabaseBrowser(); await must(sb.from('applicant_profiles').upsert({ user_id: await currentUserId(sb), personal_narrative: Object.fromEntries(Object.entries(payload).filter(([, v]) => v)) }, { onConflict: 'user_id' }).select('id')); await reload(); }} />;
}
