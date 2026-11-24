'use client';
// Turns a researched program into the user's own application rows. Every write goes through the user's session,
// so RLS and the existing triggers (default requirements, stage guard, ownership checks, XP) all still apply.
import type { SupabaseClient } from '@supabase/supabase-js';
import { must } from '@/lib/hooks';
import { CURRENCIES, NewApplicationSchema, wallToIso, zodFieldErrors } from '@/lib/applications';

/** Time zone used for a deadline picked from a school's round list (the same default as the deadline form). */
const DEFAULT_DEADLINE_TZ = 'America/New_York';
import { essayRows, parseFee, parseIntake, requirementRows, type Program, type RequirementInsert } from '@/lib/programs';
import { ROUND_ITEM, planChecklistUpdate, roundItemFirst, visibleItemCount, type ExistingReq } from '@/lib/results';

/** The program checklist as it is saved: "Pick your round and deadline" first and required. */
export const programChecklistRows = (program: Program): RequirementInsert[] => roundItemFirst(requirementRows(program));
/** The number of items the checklist page will show for this program (same number the toast uses). */
export const programChecklistCount = (program: Program) => visibleItemCount(programChecklistRows(program));

/**
 * Replaces the generic default requirements of a freshly created application with the program checklist,
 * and creates one essay record per essay prompt (linked to the application, the school and its requirement row).
 * Only rows of this one application are touched. Returns the ids of the essays it created (for cleanup on failure).
 */
export async function applyProgramChecklist(sb: SupabaseClient, appId: string, schoolId: string, program: Program): Promise<string[]> {
  const essayIds: string[] = [];
  try {
    const essays = essayRows(program);
    const byKey = new Map<string, string>();
    if (essays.length) {
      const created = (await must(sb.from('essays').insert(essays.map((e) => ({ application_id: appId, school_id: schoolId, title: e.title, prompt: e.prompt, word_limit: e.word_limit }))).select('id, title'))) as { id: string; title: string }[];
      for (const c of created) essayIds.push(c.id);
      // insert returns rows in the order given; match by title as a safety net
      essays.forEach((e, i) => { const hit = created.find((c) => c.title === e.title) ?? created[i]; if (hit) byKey.set(e.key, hit.id); });
    }
    await must(sb.from('application_requirements').delete().eq('application_id', appId).eq('is_default', true).select('id'));
    const rows = programChecklistRows(program).map((r) => ({
      application_id: appId, name: r.name, category: r.category, mandatory: r.mandatory, notes: r.notes, sort_order: r.sort_order,
      is_default: r.is_default, essay_id: r.essay_key ? byKey.get(r.essay_key) ?? null : null,
    }));
    await must(sb.from('application_requirements').insert(rows).select('id'));
    return essayIds;
  } catch (e) {
    if (essayIds.length) await sb.from('essays').delete().in('id', essayIds);
    throw e;
  }
}

/** The intake to use: the program's own term and year when it states one clearly, else the user's onboarding intake. */
export const intakeFor = (program: Program, fallback: string | undefined) => parseIntake(program.intake) ?? fallback ?? 'Fall 2027';

/**
 * Creates the application for this program (validated with the same schema as the New application form),
 * then applies the program checklist. If any step fails, the new application is removed again so nothing half-made is left.
 */
export async function startProgramApplication(sb: SupabaseClient, input: {
  schoolId: string; program: Program; fallbackIntake?: string;
  /** The round the student picked in the confirm step, with its deadline date (YYYY-MM-DD). */
  round?: { name: string; deadline: string | null } | null;
}): Promise<string> {
  const { schoolId, program } = input;
  const fee = parseFee(program.application_fee?.value, CURRENCIES);
  const parsed = NewApplicationSchema.safeParse({
    school_id: schoolId, program: program.program_name.slice(0, 120), intake: intakeFor(program, input.fallbackIntake).slice(0, 60), round: (input.round?.name ?? '').slice(0, 40), priority: 3,
    application_fee: fee ? String(fee.amount) : '', fee_currency: fee?.currency ?? 'USD', stage: 'researching', notes: '',
  });
  if (!parsed.success) throw new Error(Object.values(zodFieldErrors(parsed.error))[0] ?? 'Please check the program details');
  const { deadline_date: _d, deadline_time: _t, deadline_tz: _z, ...app } = parsed.data;
  const created = (await must(sb.from('applications').insert({ ...app, program_requirement_id: program.id }).select('id').single())) as { id: string };
  let essayIds: string[] = [];
  try {
    essayIds = await applyProgramChecklist(sb, created.id, schoolId, program);
    if (input.round?.deadline) {
      await must(sb.from('deadlines').insert({ application_id: created.id, name: 'Submission deadline', kind: 'submission', is_primary: true, timezone: DEFAULT_DEADLINE_TZ, due_at: wallToIso(input.round.deadline, '23:59', DEFAULT_DEADLINE_TZ) }).select('id'));
      await must(sb.from('application_requirements').update({ status: 'complete' }).eq('application_id', created.id).eq('name', ROUND_ITEM).select('id'));
    }
  } catch (e) {
    if (essayIds.length) await sb.from('essays').delete().in('id', essayIds);
    await sb.from('applications').delete().eq('id', created.id);
    throw new Error(`We could not set up the checklist, so the application was not created. ${e instanceof Error ? e.message : String(e)}`);
  }
  return created.id;
}

/**
 * Moves an older application from the general checklist to the school's own one. Work is never lost: done, started
 * or linked items stay (and stop the same school item from being added twice), items the student added stay, and only
 * untouched general items are removed. Essays are created for the school's prompts that are new to this application.
 * Returns how many items were added.
 */
export async function updateChecklistFromProgram(sb: SupabaseClient, appId: string, schoolId: string, program: Program): Promise<number> {
  const existing = (await must(sb.from('application_requirements').select('id,name,status,is_default,essay_id,recommendation_id').eq('application_id', appId))) as ExistingReq[];
  const incoming = programChecklistRows(program);
  const plan = planChecklistUpdate(existing, incoming);
  const essays = essayRows(program).filter((e) => plan.insert.some((r) => r.essay_key === e.key));
  const essayIds: string[] = [];
  const byKey = new Map<string, string>();
  try {
    if (essays.length) {
      const created = (await must(sb.from('essays').insert(essays.map((e) => ({ application_id: appId, school_id: schoolId, title: e.title, prompt: e.prompt, word_limit: e.word_limit }))).select('id, title'))) as { id: string; title: string }[];
      for (const c of created) essayIds.push(c.id);
      essays.forEach((e, i) => { const hit = created.find((c) => c.title === e.title) ?? created[i]; if (hit) byKey.set(e.key, hit.id); });
    }
    if (plan.insert.length) {
      await must(sb.from('application_requirements').insert(plan.insert.map((r) => ({
        application_id: appId, name: r.name, category: r.category, mandatory: r.mandatory, notes: r.notes, sort_order: r.sort_order,
        is_default: r.is_default, essay_id: r.essay_key ? byKey.get(r.essay_key) ?? null : null,
      }))).select('id'));
    }
  } catch (e) {
    if (essayIds.length) await sb.from('essays').delete().in('id', essayIds);
    throw e;
  }
  // the new items are in place, so the untouched general ones can go
  if (plan.deleteIds.length) await must(sb.from('application_requirements').delete().in('id', plan.deleteIds).select('id'));
  await Promise.all(plan.keep.map((k) => must(sb.from('application_requirements').update({ sort_order: k.sort_order }).eq('id', k.id).select('id'))));
  await must(sb.from('applications').update({ program_requirement_id: program.id }).eq('id', appId).select('id'));
  return plan.insert.length;
}
