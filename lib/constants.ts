/** The product name shown to users. */
export const APP_NAME = 'Campus Quest';
export const APP_TAGLINE = 'Find universities and keep every application on track';
/** AI Coach and Interview Practice are switched off for now (pages redirect, nothing links to them). Flip to bring their prompts back. */
export const COACH_AND_INTERVIEW_ENABLED = false;

export const STAGES = ['researching','shortlisted','preparing','ready','submitted','interview_invited','interview_scheduled','interview_completed','waitlisted','admitted','rejected','withdrawn'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  researching: 'Researching', shortlisted: 'Shortlisted', preparing: 'Preparing', ready: 'Ready for submission', submitted: 'Submitted',
  interview_invited: 'Interview invited', interview_scheduled: 'Interview scheduled', interview_completed: 'Interview completed',
  waitlisted: 'Waitlisted', admitted: 'Admitted', rejected: 'Rejected', withdrawn: 'Withdrawn',
};
/** Dashboard pipeline columns and the stages each one groups. */
export const PIPELINE: { key: string; label: string; stages: Stage[] }[] = [
  { key: 'research', label: 'Research', stages: ['researching'] },
  { key: 'shortlisted', label: 'Shortlisted', stages: ['shortlisted'] },
  { key: 'preparing', label: 'Preparing', stages: ['preparing'] },
  { key: 'ready', label: 'Ready', stages: ['ready'] },
  { key: 'submitted', label: 'Submitted', stages: ['submitted'] },
  { key: 'interview', label: 'Interview', stages: ['interview_invited', 'interview_scheduled', 'interview_completed'] },
  { key: 'decision', label: 'Decision', stages: ['waitlisted', 'admitted', 'rejected', 'withdrawn'] },
];
/** Stages that count as "in progress" (not yet submitted and not closed). */
export const IN_PROGRESS: Stage[] = ['researching', 'shortlisted', 'preparing', 'ready'];
export const SUBMITTED_OR_LATER: Stage[] = ['submitted', 'interview_invited', 'interview_scheduled', 'interview_completed', 'waitlisted', 'admitted', 'rejected'];
export const CLOSED: Stage[] = ['admitted', 'rejected', 'withdrawn'];

export const TIERS = ['dream', 'reach', 'competitive', 'target', 'safer'] as const;
export const TIER_LABEL: Record<string, string> = { dream: 'Dream', reach: 'Reach', competitive: 'Competitive', target: 'Target', safer: 'Safer option' };
export const REQ_STATUS = ['not_started', 'in_progress', 'complete', 'waived'] as const;
export const NAV = [
  { href: '/journey', label: 'Journey', icon: 'Map' },
  { href: '/', label: 'Overview', icon: 'LayoutDashboard' },
  { href: '/profile', label: 'My Profile', icon: 'User' },
  { href: '/schools', label: 'Find universities', icon: 'GraduationCap' },
  { href: '/applications', label: 'Applications', icon: 'Kanban' },
  { href: '/essays', label: 'Essays', icon: 'FileText' },
  { href: '/recommendations', label: 'Recommenders', icon: 'Users' },
  { href: '/settings', label: 'Settings', icon: 'Settings' },
] as const;
