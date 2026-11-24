import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').nullable();
const optText = (max = 4000) => z.string().max(max, `Max ${max} characters`).nullable();
const order = (a: string | null, b: string | null) => !a || !b || b >= a;

export const EducationSchema = z.object({
  institution: z.string().min(1, 'Institution is required').max(200),
  degree: optText(200), major: optText(200), country: optText(100), graduation_date: date,
  gpa: z.number().min(0, 'GPA cannot be negative').nullable(), gpa_scale: z.number().positive('Scale must be above 0').nullable(),
  honors: optText(500), additional_qualifications: optText(),
  enrollment_status: z.enum(['completed', 'current', 'incomplete']),
}).superRefine((v, c) => {
  if (v.gpa != null && v.gpa_scale == null) c.addIssue({ code: 'custom', path: ['gpa_scale'], message: 'Enter the GPA scale (for example 4.0)' });
  if (v.gpa_scale != null && v.gpa == null) c.addIssue({ code: 'custom', path: ['gpa'], message: 'Enter your GPA or clear the scale' });
  if (v.gpa != null && v.gpa_scale != null && v.gpa > v.gpa_scale) c.addIssue({ code: 'custom', path: ['gpa'], message: `GPA cannot be higher than the scale (${v.gpa_scale})` });
});

// Date rules (required when taken, not in the future, optional target date when planned) live in validateTestScore.
export const TestSchema = z.object({
  test_type: z.enum(['GMAT', 'GRE', 'SAT', 'ACT', 'IELTS', 'TOEFL', 'PTE', 'DUOLINGO', 'OTHER']), status: z.enum(['taken', 'planned']), exam_version: optText(100),
  overall: z.number().nullable(), quant: z.number().nullable(), verbal: z.number().nullable(), data_insights: z.number().nullable(), analytical_writing: z.number().nullable(),
  test_date: date, attempt_number: z.number('Enter a whole number').int('Whole number').min(1, 'Attempt must be 1 or more'), notes: optText(),
});

export const WorkSchema = z.object({
  company: z.string().min(1, 'Company is required').max(200), position: z.string().min(1, 'Position is required').max(200),
  industry: optText(200), location: optText(200), start_date: date, end_date: date, employment_type: optText(100),
  description: optText(), responsibilities: optText(), achievements: optText(),
  team_size: z.number().int('Whole number').min(0, 'Cannot be negative').nullable(), budget_ownership: optText(500), promotions: optText(), measurable_impact: optText(),
}).superRefine((v, c) => { if (!order(v.start_date, v.end_date)) c.addIssue({ code: 'custom', path: ['end_date'], message: 'End date must be on or after the start date' }); });

export const LeadershipSchema = z.object({
  organization: z.string().min(1, 'Organization is required').max(200), role: optText(200), start_date: date, end_date: date,
  responsibilities: optText(), leadership_experience: optText(), achievements: optText(), social_impact: optText(), awards: optText(),
}).superRefine((v, c) => { if (!order(v.start_date, v.end_date)) c.addIssue({ code: 'custom', path: ['end_date'], message: 'End date must be on or after the start date' }); });

export const AchievementSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200), description: optText(), achieved_on: date, quantified_impact: optText(1000),
});

export const PersonalSchema = z.object({
  full_name: z.string().min(1, 'Full name is required').max(200), preferred_name: optText(100),
  email: z.string().email('Enter a valid email').nullable().or(z.literal(null)), nationality: optText(100), current_country: optText(100), current_city: optText(100),
});
export const GoalsSchema = z.object({
  why_mba: optText(), why_now: optText(), short_term_goal: optText(), long_term_goal: optText(), target_industry: optText(200), target_function: optText(200),
  target_geography: optText(200), career_transition: optText(), target_companies: z.array(z.string().max(100)).max(30, 'Max 30 companies'),
});
export const UndergradGoalsSchema = z.object({ why_mba: optText(), short_term_goal: optText(), long_term_goal: optText() });
export const NarrativeSchema = z.object({
  background: optText(), life_experiences: optText(), motivations: optText(), challenges: optText(), leadership_philosophy: optText(), values: optText(), aspirations: optText(),
});
