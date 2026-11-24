// Structured context retrieval for the AI coach. Pure ranking/assembly functions are exported for unit tests;
// loadContext() takes a Supabase client (the user's session client, so RLS applies) and returns only the records
// relevant to the requested mode. No service role, no secrets, no 'server-only' import so it stays testable.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ContextMode = 'strategist' | 'essay_coach' | 'interview_coach' | 'execution' | 'assess_profile' | 'school_gap' | 'essay_review' | 'interview';
export type UsedContext = { kind: string; id: string; label: string };
export type CtxItem = UsedContext & { body: string; priority: number };

const STOP = new Set('the and for with that this from have has had was were are you your our their they them about into over under what when where which while will would could should can not but all any more most some such than then also its his her she him who why how out off one two had get got did does done been being very just only own per via'.split(' '));

export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return Array.from(new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w))));
}
export function truncate(text: string | null | undefined, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, Math.max(0, max - 1));
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut) + '…';
}
/** "key: value" lines, skipping empty values. Each value is truncated. */
export function kv(pairs: [string, unknown][], maxEach = 400): string {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '' && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `${k}: ${truncate(Array.isArray(v) ? v.join(', ') : String(v), maxEach)}`)
    .join('\n');
}

export type Rankable = { id: string; updated_at?: string | null };
export type Weighted = { text: string | null | undefined; weight: number };
/** Relevance = weighted count of distinct query tokens found in each field. Ties: more recent first, then id (deterministic). */
export function scoreItem(fields: Weighted[], queryTokens: string[]): number {
  if (!queryTokens.length) return 0;
  let s = 0;
  for (const f of fields) {
    const toks = new Set(tokenize(f.text));
    for (const q of queryTokens) if (toks.has(q)) s += f.weight;
  }
  return s;
}
export function rankItems<T extends Rankable>(items: T[], query: string, fieldsOf: (t: T) => Weighted[], limit: number): (T & { _score: number })[] {
  const qt = tokenize(query);
  return items
    .map((t) => ({ ...t, _score: scoreItem(fieldsOf(t), qt) }))
    .sort((a, b) => b._score - a._score || (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit));
}

/** Keeps the highest-priority items inside the character budget (truncating the last one that partly fits),
 *  then emits them in their original order, each under a `[kind:id] label` heading the model can cite. */
export function assembleContext(items: CtxItem[], maxChars: number): { text: string; used: UsedContext[]; dropped: UsedContext[] } {
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => b.it.priority - a.it.priority || a.i - b.i);
  let remaining = maxChars;
  const keep = new Map<number, string>();
  const dropped: UsedContext[] = [];
  for (const { it, i } of order) {
    const head = `[${it.kind}:${it.id}] ${it.label}\n`;
    const room = remaining - head.length - 2;
    if (room <= 0) { dropped.push({ kind: it.kind, id: it.id, label: it.label }); continue; }
    if (it.body.length <= room) { keep.set(i, head + it.body); remaining -= head.length + it.body.length + 2; continue; }
    if (room >= 200) { keep.set(i, head + truncate(it.body, room)); remaining = 0; continue; }
    dropped.push({ kind: it.kind, id: it.id, label: it.label });
  }
  const used: UsedContext[] = []; const parts: string[] = [];
  items.forEach((it, i) => { const t = keep.get(i); if (t !== undefined) { parts.push(t); used.push({ kind: it.kind, id: it.id, label: it.label }); } });
  return { text: parts.join('\n\n'), used, dropped };
}

type Plan = { profile: boolean; education: boolean; tests: boolean; work: boolean; leadership: boolean; achievements: boolean; goals: boolean; stories: 'none' | 'ranked'; storyLimit: number; school: boolean; schoolData: boolean; applications: 'none' | 'focus' | 'all'; essays: 'none' | 'list' | 'focus'; assessments: boolean; tasks: boolean };
const NONE: Plan = { profile: false, education: false, tests: false, work: false, leadership: false, achievements: false, goals: false, stories: 'none', storyLimit: 0, school: false, schoolData: false, applications: 'none', essays: 'none', assessments: false, tasks: false };
export const PLANS: Record<ContextMode, Plan> = {
  strategist: { ...NONE, profile: true, education: true, tests: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 4, school: true, schoolData: true, applications: 'all', essays: 'list', assessments: true },
  essay_coach: { ...NONE, profile: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 5, school: true, schoolData: true, applications: 'focus', essays: 'focus' },
  interview_coach: { ...NONE, profile: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 6, school: true, schoolData: true, applications: 'focus' },
  execution: { ...NONE, goals: false, school: true, applications: 'all', essays: 'list', tasks: true },
  assess_profile: { ...NONE, profile: true, education: true, tests: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 5, school: true, schoolData: true, applications: 'all', essays: 'list', tasks: true, assessments: true },
  school_gap: { ...NONE, profile: true, education: true, tests: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 4, school: true, schoolData: true, applications: 'focus', essays: 'list', tasks: true, assessments: true },
  essay_review: { ...NONE, profile: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 5, school: true, schoolData: true, applications: 'focus' },
  interview: { ...NONE, profile: true, work: true, leadership: true, achievements: true, goals: true, stories: 'ranked', storyLimit: 6, school: true, schoolData: true, applications: 'focus' },
};

export type LoadOpts = { mode: ContextMode; schoolId?: string | null; applicationId?: string | null; essayId?: string | null; query?: string; maxChars?: number; includeEssayDraft?: boolean };
export type LoadedContext = { text: string; used: UsedContext[]; dropped: UsedContext[]; schoolId: string | null; applicationId: string | null; hasSchoolData: boolean; snapshot: Record<string, unknown> };

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function rows(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await p; if (error) throw new Error(error.message); return (data as Row[] | null) ?? [];
}
const span = (a?: string | null, b?: string | null) => [a?.slice(0, 7), b ? b.slice(0, 7) : a ? 'present' : null].filter(Boolean).join(' to ');

export async function loadContext(sb: SupabaseClient, o: LoadOpts): Promise<LoadedContext> {
  const plan = PLANS[o.mode];
  let schoolId = o.schoolId ?? null; let applicationId = o.applicationId ?? null;
  let essay: Row | null = null; let application: Row | null = null;
  if (o.essayId) {
    essay = (await rows(sb.from('essays').select('id,title,prompt,word_limit,status,draft,school_id,application_id,updated_at').eq('id', o.essayId).is('deleted_at', null).limit(1)))[0] ?? null;
    if (essay) { schoolId = schoolId ?? essay.school_id; applicationId = applicationId ?? essay.application_id; }
  }
  if (applicationId) {
    application = (await rows(sb.from('applications').select('id,school_id,program,intake,round,priority,stage,notes,submitted_at').eq('id', applicationId).is('deleted_at', null).limit(1)))[0] ?? null;
    if (application) schoolId = schoolId ?? application.school_id; else applicationId = null;
  }
  const notDeleted = <T extends { is: (c: string, v: null) => T }>(q: T) => q.is('deleted_at', null);
  const [prof, edu, tests, work, lead, ach, goals, stories, school, sdata, apps, essays, assess, tasks] = await Promise.all([
    plan.profile ? rows(sb.from('applicant_profiles').select('id,full_name,preferred_name,nationality,current_country,current_city,personal_narrative').is('deleted_at', null).limit(1)) : [],
    plan.education ? rows(notDeleted(sb.from('education_records').select('id,institution,degree,major,country,graduation_date,gpa,gpa_scale,honors,additional_qualifications,enrollment_status'))) : [],
    plan.tests ? rows(notDeleted(sb.from('test_scores').select('id,test_type,exam_version,overall,quant,verbal,data_insights,analytical_writing,test_date,attempt_number,notes'))) : [],
    plan.work ? rows(notDeleted(sb.from('work_experiences').select('id,company,industry,position,location,start_date,end_date,description,responsibilities,achievements,team_size,budget_ownership,promotions,measurable_impact').order('start_date', { ascending: false }))) : [],
    plan.leadership ? rows(notDeleted(sb.from('leadership_experiences').select('id,organization,role,start_date,end_date,responsibilities,leadership_experience,achievements,social_impact,awards'))) : [],
    plan.achievements ? rows(notDeleted(sb.from('achievements').select('id,title,description,achieved_on,quantified_impact'))) : [],
    plan.goals ? rows(sb.from('career_goals').select('id,why_mba,why_now,short_term_goal,long_term_goal,target_industry,target_function,target_geography,career_transition,target_companies').limit(1)) : [],
    plan.stories !== 'none' ? rows(notDeleted(sb.from('story_bank').select('id,title,category,situation,task,action,result,lessons_learned,quantified_impact,competencies,related_school_ids,updated_at'))) : [],
    plan.school && schoolId ? rows(sb.from('schools').select('id,name,short_name,country,location,tier,priority,notes,website_url').eq('id', schoolId).is('deleted_at', null).limit(1)) : [],
    plan.schoolData && schoolId ? rows(sb.from('school_admissions_data').select('id,field,value_num,value_text,currency,source_name,source_url,date_accessed,publication_year,verification_status').eq('school_id', schoolId)) : [],
    plan.applications !== 'none' ? rows(notDeleted(sb.from('applications').select('id,school_id,program,intake,round,priority,stage,submitted_at,schools(name)'))) : [],
    plan.essays === 'list' ? rows(notDeleted(sb.from('essays').select('id,title,status,word_limit,school_id,application_id,updated_at'))) : [],
    plan.assessments ? rows(sb.from('ai_assessments').select('id,kind,school_id,result,created_at').in('kind', ['profile', 'school_gap']).order('created_at', { ascending: false }).limit(6)) : [],
    plan.tasks ? rows(sb.from('application_tasks').select('id,title,status,due_date,application_id,completed_at,priority').order('due_date', { ascending: true, nullsFirst: false }).limit(60)) : [],
  ]);

  const items: CtxItem[] = [];
  const add = (kind: string, id: string, label: string, body: string, priority: number) => { if (body.trim()) items.push({ kind, id, label, body, priority }); };

  // focused records first (highest priority)
  if (essay && plan.essays === 'focus') {
    const draft = o.includeEssayDraft === false ? '(draft supplied separately)' : truncate(essay.draft, 9000);
    add('essay', essay.id, `Essay: ${essay.title}`, kv([['Prompt', essay.prompt], ['Word limit', essay.word_limit], ['Status', essay.status], ['Draft', draft]], 9000), 100);
  }
  if (school[0]) { const s = school[0]; add('school', s.id, `School: ${s.name}`, kv([['Location', [s.location, s.country].filter(Boolean).join(', ')], ['Applicant tier (user-set)', s.tier], ['Priority', s.priority], ['Notes', s.notes]]), 95); }
  if (plan.schoolData && schoolId) {
    const name = school[0]?.name ?? 'selected school';
    const body = sdata.length
      ? sdata.map((r) => `${r.field}: ${r.value_num ?? r.value_text}${r.currency ? ' ' + r.currency : ''} (source: ${r.source_name}, ${r.publication_year ?? 'year n/a'}, accessed ${r.date_accessed}, ${r.verification_status})`).join('\n')
      : 'NOT RESEARCHED: no sourced admissions data rows exist for this school. Do not state any statistic for it.';
    add('school_data', schoolId, `Sourced school data: ${name} (${sdata.length} rows)`, body, 94);
  }
  if (application) add('application', application.id, `Application: ${school[0]?.name ?? 'school'} ${application.intake}${application.round ? ' ' + application.round : ''}`, kv([['Stage', application.stage], ['Program', application.program], ['Priority', application.priority], ['Submitted', application.submitted_at], ['Notes', application.notes]]), 90);
  const goal = goals[0];
  if (goal) add('career_goals', goal.id, 'Career goals', kv([['Why MBA', goal.why_mba], ['Why now', goal.why_now], ['Short-term goal', goal.short_term_goal], ['Long-term goal', goal.long_term_goal], ['Target industry', goal.target_industry], ['Target function', goal.target_function], ['Target geography', goal.target_geography], ['Career transition', goal.career_transition], ['Target companies', goal.target_companies]], 500), 85);
  const p = prof[0];
  if (p) add('profile', p.id, 'Applicant profile', kv([['Name', p.preferred_name || p.full_name], ['Nationality', p.nationality], ['Location', [p.current_city, p.current_country].filter(Boolean).join(', ')], ['Narrative', Object.keys(p.personal_narrative ?? {}).length ? JSON.stringify(p.personal_narrative) : null]], 600), 70);
  work.forEach((w) => add('work', w.id, `Work: ${w.position} at ${w.company}`, kv([['Period', span(w.start_date, w.end_date)], ['Industry', w.industry], ['Location', w.location], ['Description', w.description], ['Responsibilities', w.responsibilities], ['Achievements', w.achievements], ['Measurable impact', w.measurable_impact], ['Team size', w.team_size], ['Budget ownership', w.budget_ownership], ['Promotions', w.promotions]], 500), 80));
  lead.forEach((l) => add('leadership', l.id, `Leadership: ${l.role ?? 'Role'} at ${l.organization}`, kv([['Period', span(l.start_date, l.end_date)], ['Responsibilities', l.responsibilities], ['Leadership', l.leadership_experience], ['Achievements', l.achievements], ['Social impact', l.social_impact], ['Awards', l.awards]], 400), 75));
  ach.forEach((a) => add('achievement', a.id, `Achievement: ${a.title}`, kv([['Date', a.achieved_on], ['Description', a.description], ['Quantified impact', a.quantified_impact]], 300), 65));
  edu.forEach((e) => add('education', e.id, `Education: ${e.degree ?? 'Degree'} at ${e.institution}`, kv([['Major', e.major], ['Country', e.country], ['Graduated', e.graduation_date], ['GPA', e.gpa != null ? `${e.gpa}${e.gpa_scale ? ' / ' + e.gpa_scale : ''}` : null], ['Honors', e.honors], ['Other qualifications', e.additional_qualifications], ['Status', e.enrollment_status]]), 78));
  tests.forEach((t) => add('test', t.id, `Test: ${t.test_type}${t.exam_version ? ' ' + t.exam_version : ''} attempt ${t.attempt_number}`, kv([['Overall', t.overall], ['Quant', t.quant], ['Verbal', t.verbal], ['Data insights', t.data_insights], ['Analytical writing', t.analytical_writing], ['Date', t.test_date], ['Notes', t.notes]]), 78));
  if (plan.stories === 'ranked' && stories.length) {
    const query = [o.query, essay?.prompt, essay?.title, school[0]?.name, goal?.short_term_goal, goal?.career_transition].filter(Boolean).join(' ');
    const ranked = rankItems(stories as (Row & { id: string })[], query, (s) => [{ text: s.title, weight: 3 }, { text: s.category, weight: 2 }, { text: (s.competencies ?? []).join(' '), weight: 2 }, { text: [s.situation, s.action, s.result, s.lessons_learned].join(' '), weight: 1 }], plan.storyLimit);
    ranked.forEach((s) => add('story', s.id, `Story: ${s.title} (${s.category})`, kv([['Situation', s.situation], ['Task', s.task], ['Action', s.action], ['Result', s.result], ['Lessons', s.lessons_learned], ['Quantified impact', s.quantified_impact]], 350), 60 + Math.min(9, s._score)));
  }
  if (plan.applications === 'all' || (plan.applications === 'focus' && !application && apps.length)) {
    const list = apps.filter((a) => (plan.applications === 'all' ? true : a.school_id === schoolId));
    if (list.length) add('applications', 'all', `Application pipeline (${list.length})`, list.map((a) => `${a.id}: ${a.schools?.name ?? 'school'} | ${a.intake}${a.round ? ' ' + a.round : ''} | stage ${a.stage} | priority ${a.priority}`).join('\n'), 55);
  }
  if (plan.essays === 'list' && essays.length) add('essays', 'all', `Essays (${essays.length}, drafts not included)`, essays.slice(0, 25).map((e) => `${e.id}: ${e.title} | ${e.status}${e.word_limit ? ' | limit ' + e.word_limit : ''}`).join('\n'), 50);
  if (plan.tasks && tasks.length) {
    const open = tasks.filter((t) => t.status !== 'done' && (!applicationId || t.application_id === applicationId || !t.application_id)).slice(0, 15);
    const done = tasks.filter((t) => t.status === 'done').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 10);
    add('tasks', 'open', `Open tasks (${open.length})`, open.map((t) => `${t.id}: ${t.title} | ${t.status} | due ${t.due_date ?? 'none'}`).join('\n'), 58);
    add('tasks', 'done', `Recently completed tasks (${done.length})`, done.map((t) => `${t.title} (completed ${String(t.completed_at ?? '').slice(0, 10)})`).join('\n'), 45);
  }
  if (plan.assessments && assess.length) {
    assess.filter((a) => a.kind === 'profile' || a.school_id === schoolId).slice(0, 2).forEach((a) => add('assessment', a.id, `Previous ${a.kind} assessment (${String(a.created_at).slice(0, 10)})`, kv([['Tier', a.result?.tier], ['Overall', a.result?.overall]], 700), 40));
  }

  const max = o.maxChars ?? 14000;
  const { text, used, dropped } = assembleContext(items, max);
  return {
    text, used, dropped, schoolId, applicationId, hasSchoolData: sdata.length > 0,
    snapshot: { mode: o.mode, schoolId, applicationId, essayId: o.essayId ?? null, used, dropped, schoolDataRows: sdata.length, chars: text.length },
  };
}
