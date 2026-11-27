// "Your story": the answers schools ask for again and again (goals, work, tests, education), gathered from the profile
// so a student can copy them into an essay instead of retyping. Pure: no database, nothing is stored here.
import { TEST_LABEL, filled, fmtMonthYear, goalFields, type EducationRow, type GoalsRow, type ProfileProgram, type ProfileTrack, type TestRow, type WorkRow } from './profile.ts';

export type StoryItem = { label: string; text: string };
export type StoryBlock = { key: 'goals' | 'work' | 'education' | 'tests'; title: string; items: StoryItem[] };
export type StoryInput = { track: ProfileTrack; program?: ProfileProgram; goals: GoalsRow | null; work: WorkRow[]; education: EducationRow[]; tests: TestRow[] };

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const span = (a?: string | null, b?: string | null) => {
  const from = a ? fmtMonthYear(a) : ''; const to = b ? fmtMonthYear(b) : (a ? 'present' : '');
  return from ? `${from} to ${to}` : '';
};
const num = (n: number | null | undefined) => (n == null ? '' : String(n));

function goalItems(i: StoryInput): StoryItem[] {
  const g = i.goals; if (!g) return [];
  const out: StoryItem[] = [];
  for (const [key, label] of goalFields(i.track, i.program)) { const t = clean(g[key]); if (t) out.push({ label, text: t }); }
  if (i.track !== 'undergrad') {
    if (filled(g.target_companies)) out.push({ label: 'Target companies', text: (g.target_companies ?? []).join(', ') });
    const t = clean(g.career_transition); if (t) out.push({ label: 'Career transition', text: t });
  }
  return out;
}
function workItems(rows: WorkRow[]): StoryItem[] {
  return rows.map((w) => {
    const head = [`${w.position} at ${w.company}`, span(w.start_date, w.end_date) && `(${span(w.start_date, w.end_date)})`].filter(Boolean).join(' ');
    const lines = [head, clean(w.description), clean(w.responsibilities) && `Responsibilities: ${clean(w.responsibilities)}`, clean(w.achievements) && `Achievements: ${clean(w.achievements)}`, clean(w.measurable_impact) && `Impact: ${clean(w.measurable_impact)}`, clean(w.promotions) && `Promotions: ${clean(w.promotions)}`].filter(Boolean);
    return { label: `${w.position}, ${w.company}`, text: lines.join('\n') };
  });
}
function educationItems(rows: EducationRow[]): StoryItem[] {
  return rows.map((e) => {
    const what = [clean(e.degree), clean(e.major)].filter(Boolean).join(', ');
    const gpa = e.gpa != null ? `GPA ${e.gpa}${e.gpa_scale ? ` / ${e.gpa_scale}` : ''}` : '';
    const grad = e.graduation_date ? `${e.enrollment_status === 'current' ? 'expected ' : ''}${fmtMonthYear(e.graduation_date)}` : '';
    const text = [[what, clean(e.institution)].filter(Boolean).join(' at '), clean(e.country), grad, gpa, clean(e.honors)].filter(Boolean).join('. ');
    return { label: clean(e.institution) || 'Education', text };
  });
}
/** Taken tests only: a planned test has no score to quote. */
function testItems(rows: TestRow[]): StoryItem[] {
  return rows.filter((t) => t.status !== 'planned' && t.overall != null).map((t) => {
    const parts = [t.quant != null ? `quant ${num(t.quant)}` : '', t.verbal != null ? `verbal ${num(t.verbal)}` : '', t.data_insights != null ? `data insights ${num(t.data_insights)}` : '', t.analytical_writing != null ? `writing ${num(t.analytical_writing)}` : ''].filter(Boolean);
    const when = t.test_date ? `taken ${fmtMonthYear(t.test_date)}` : '';
    const text = `${TEST_LABEL[t.test_type]} ${num(t.overall)}${parts.length ? ` (${parts.join(', ')})` : ''}${when ? `, ${when}` : ''}`;
    return { label: TEST_LABEL[t.test_type], text };
  });
}

/** The blocks that have something in them, goals first. Empty when the student has filled nothing in (that is fine). */
export function buildStory(i: StoryInput): StoryBlock[] {
  const undergrad = i.track === 'undergrad';
  const blocks: StoryBlock[] = [
    { key: 'goals', title: undergrad ? 'What you want to study' : 'Career goals', items: goalItems(i) },
    { key: 'work', title: 'Work experience', items: workItems(i.work) },
    { key: 'education', title: 'Education', items: educationItems(i.education) },
    { key: 'tests', title: 'Test scores', items: testItems(i.tests) },
  ];
  const order: StoryBlock['key'][] = undergrad ? ['education', 'goals', 'tests', 'work'] : ['goals', 'work', 'education', 'tests'];
  return order.map((k) => blocks.find((b) => b.key === k)!).filter((b) => b.items.length > 0);
}
