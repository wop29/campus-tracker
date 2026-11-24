// Pure recommendation logic: pipeline, risk flags, reminder timing, requirement matching and AI prompt building.
import { z } from 'zod';

export const REC_STATUSES = ['not_contacted', 'contacted', 'agreed', 'briefing_sent', 'in_progress', 'submitted', 'follow_up_required'] as const;
export type RecStatus = (typeof REC_STATUSES)[number];
export const REC_STATUS_LABEL: Record<RecStatus, string> = {
  not_contacted: 'Not contacted', contacted: 'Contacted', agreed: 'Agreed', briefing_sent: 'Briefing sent', in_progress: 'In progress', submitted: 'Submitted', follow_up_required: 'Follow-up required',
};
export type RecommenderRow = { id: string; name: string; position: string | null; company: string | null; email: string | null; relationship: string | null; background: string | null; contacted_at: string | null; notes: string | null; deleted_at: string | null };
export type RecommendationRow = { id: string; recommender_id: string; application_id: string; status: RecStatus; deadline: string | null; last_contact_at: string | null; submitted_at: string | null; notes: string | null; created_at: string };

const optStr = (max: number) => z.string().trim().max(max, `Keep this under ${max} characters`).optional();
export const recommenderSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  position: optStr(200), company: optStr(200),
  email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().email('Enter a valid email').max(254).optional()),
  relationship: optStr(500), background: optStr(5000), notes: optStr(5000),
  contacted_at: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional()),
});
export const assignmentSchema = z.object({
  recommender_id: z.string().uuid('Choose a recommender'),
  application_id: z.string().uuid('Choose an application'),
  deadline: z.preprocess((v) => (v === '' ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').optional()),
});

export const AT_RISK_DAYS = 14;
export const REMINDER_GAP_DAYS = 7;
const DAY = 86_400_000;
export type RiskFlag = 'none' | 'overdue' | 'at_risk' | 'follow_up';

/** Overdue: deadline passed and not submitted. At risk: deadline within 14 days and not submitted. */
export function recRisk(r: Pick<RecommendationRow, 'status' | 'deadline'>, now: Date = new Date()): RiskFlag {
  if (r.status === 'submitted') return 'none';
  if (r.deadline) {
    const left = new Date(r.deadline).getTime() - now.getTime();
    if (left < 0) return 'overdue';
    if (left <= AT_RISK_DAYS * DAY) return 'at_risk';
  }
  return r.status === 'follow_up_required' ? 'follow_up' : 'none';
}
export const daysUntil = (iso: string, now: Date = new Date()) => Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY);

/** Suggest a reminder when something is still open, the deadline is close, and you have not been in touch for a week. Advisory only: nothing is sent. */
export function reminderDue(r: Pick<RecommendationRow, 'status' | 'deadline' | 'last_contact_at'>, now: Date = new Date()): boolean {
  if (r.status === 'submitted' || r.status === 'not_contacted') return false;
  const risk = recRisk(r, now);
  if (risk !== 'overdue' && risk !== 'at_risk' && r.status !== 'follow_up_required') return false;
  if (!r.last_contact_at) return true;
  return now.getTime() - new Date(r.last_contact_at).getTime() >= REMINDER_GAP_DAYS * DAY;
}

/** 'Recommendation 1' / 'Recommendation 2' by order of assignment within one application; a third recommender has no default requirement. */
export function requirementNameFor(recId: string, recsForApplication: { id: string; created_at: string }[]): string | null {
  const sorted = [...recsForApplication].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const i = sorted.findIndex((r) => r.id === recId);
  return i === 0 ? 'Recommendation 1' : i === 1 ? 'Recommendation 2' : null;
}
/** What the matching requirement should become when a recommendation changes status. null = leave it alone. */
export function requirementTarget(prev: RecStatus | null, next: RecStatus): 'complete' | 'in_progress' | null {
  if (next === 'submitted' && prev !== 'submitted') return 'complete';
  if (prev === 'submitted' && next !== 'submitted') return 'in_progress';
  return null;
}
export const statusPatch = (next: RecStatus, now: Date = new Date()) => ({ status: next, submitted_at: next === 'submitted' ? now.toISOString() : null });

// ---------- AI assistance ----------
export const REC_AI_KINDS = [
  { kind: 'briefing', label: 'Recommender briefing note' },
  { kind: 'achievements', label: 'Achievement summary' },
  { kind: 'examples', label: 'Examples to highlight' },
  { kind: 'school_guidance', label: 'School-specific guidance' },
  { kind: 'reminder', label: 'Polite reminder email' },
] as const;
export type RecAiKind = (typeof REC_AI_KINDS)[number]['kind'];

export const REC_AI_SYSTEM = [
  'You help an MBA applicant prepare materials FOR their recommender. The applicant is the author of everything you write.',
  'Hard rules:',
  '- Use ONLY the facts supplied in the user message. Never invent achievements, numbers, dates, projects, titles, school requirements or personal history. If something is missing, say what is missing instead of guessing.',
  '- Never write the recommendation itself, never draft text in the recommender\'s voice, and never state or imply what the recommender thinks, has observed or will say. Do not write praise as though the recommender said it.',
  '- Write from the applicant\'s point of view, addressed to the recommender, or as neutral notes for the applicant.',
  '- Do not claim anything has been sent, scheduled or agreed. This is a draft for the applicant to review, edit and send themselves.',
  '- Do not invent what a school looks for. For school guidance, only restate the application facts given and list what the applicant should confirm on the school\'s official recommender instructions.',
  '- Plain, warm, direct English. No em dashes.',
].join('\n');

export type RecAiContext = {
  kind: RecAiKind;
  applicantName?: string;
  recommender: { name: string; position?: string | null; company?: string | null; relationship?: string | null; background?: string | null };
  application: { school: string; program?: string | null; intake?: string | null; round?: string | null };
  recommendation: { status: string; deadline?: string | null; lastContact?: string | null };
  experiences: { company: string; position: string; description?: string | null; achievements?: string | null; measurable_impact?: string | null }[];
  achievements: { title: string; description?: string | null; quantified_impact?: string | null }[];
  stories: { title: string; situation?: string | null; action?: string | null; result?: string | null; quantified_impact?: string | null }[];
  extraNotes?: string;
};
const line = (label: string, v?: string | null) => (v && v.trim() ? `${label}: ${v.trim()}` : null);
export function buildRecAiRequest(c: RecAiContext): { system: string; prompt: string; maxTokens: number } {
  const instr: Record<RecAiKind, string> = {
    briefing: 'Write a briefing note the applicant can send to this recommender. Cover: the applicant\'s goals for the application as given, the projects and period the recommender worked with the applicant (only if stated), and practical points (school, deadline). Ask the recommender nothing about their opinions. Do not write any evaluation of the applicant.',
    achievements: 'Write a concise bullet summary of the selected achievements for the recommender to refer to, using only the facts and numbers provided. Mark anything where the provided detail is thin.',
    examples: 'Suggest which of the selected records the applicant might ask the recommender to be free to mention, and why each could be relevant, as notes for the applicant. Do not write the recommender\'s words. Say plainly if the provided records are too thin to suggest examples.',
    school_guidance: 'Give guidance for this specific school using only the application facts supplied. List what the applicant should check on the school\'s official recommender instructions (format, questions, word limits, submission method, deadline). Do not state any school requirement as fact.',
    reminder: 'Draft a short, polite reminder email from the applicant to the recommender about the open recommendation for this school and deadline. Include a subject line. Be gracious, make it easy to say if they need anything, and do not claim anything was already sent or that they agreed to anything beyond what the status states.',
  };
  const parts = [
    `Task: ${instr[c.kind]}`,
    '',
    `Applicant: ${c.applicantName?.trim() || '[Your name]'}`,
    `School: ${c.application.school}${[c.application.program, c.application.intake, c.application.round].filter(Boolean).length ? ` (${[c.application.program, c.application.intake, c.application.round].filter(Boolean).join(', ')})` : ''}`,
    `Recommendation status: ${c.recommendation.status}`,
    line('Recommendation deadline', c.recommendation.deadline), line('Last contact with recommender', c.recommendation.lastContact),
    '',
    'Recommender (as recorded by the applicant):',
    `Name: ${c.recommender.name}`, line('Position', c.recommender.position), line('Company', c.recommender.company), line('Relationship to applicant', c.recommender.relationship), line('Background notes', c.recommender.background),
  ].filter((x) => x !== null) as string[];
  if (c.experiences.length) parts.push('', 'Selected work experience records:', ...c.experiences.map((e) => [`- ${e.position} at ${e.company}`, line('  Description', e.description), line('  Achievements', e.achievements), line('  Measurable impact', e.measurable_impact)].filter(Boolean).join('\n')));
  if (c.achievements.length) parts.push('', 'Selected achievements:', ...c.achievements.map((a) => [`- ${a.title}`, line('  Detail', a.description), line('  Quantified impact', a.quantified_impact)].filter(Boolean).join('\n')));
  if (c.stories.length) parts.push('', 'Selected stories from the applicant\'s story bank:', ...c.stories.map((s) => [`- ${s.title}`, line('  Situation', s.situation), line('  Action', s.action), line('  Result', s.result), line('  Quantified impact', s.quantified_impact)].filter(Boolean).join('\n')));
  if (!c.experiences.length && !c.achievements.length && !c.stories.length) parts.push('', 'No applicant records were selected.');
  if (c.extraNotes?.trim()) parts.push('', `Applicant's own notes: ${c.extraNotes.trim()}`);
  return { system: REC_AI_SYSTEM, prompt: parts.join('\n'), maxTokens: 1200 };
}

// ---------- form copy per track ----------
/** Labels and examples for the recommender form. Undergrads ask teachers and counselors, grads ask managers and colleagues. */
export type RecommenderCopy = { orgLabel: string; positionHint: string; relationshipHint: string; emptyHint: string; backgroundHint: string };
export function recommenderCopy(track: 'grad' | 'undergrad' | null | undefined): RecommenderCopy {
  return track === 'undergrad'
    ? { orgLabel: 'School or organisation', positionHint: 'e.g. Maths teacher, school counselor', relationshipHint: 'e.g. My maths teacher for 2 years',
      emptyHint: 'Add the teachers, counselors or mentors you plan to ask, then assign them to each university separately.',
      backgroundHint: 'Classes, projects or activities you did together, and anything you want them to remember about you.' }
    : { orgLabel: 'Company', positionHint: 'e.g. Senior Manager', relationshipHint: 'e.g. Direct manager for 3 years',
      emptyHint: 'Add the people you plan to ask, then assign them to each school separately.',
      backgroundHint: 'Projects you worked on together, facts you want them to be aware of.' };
}
