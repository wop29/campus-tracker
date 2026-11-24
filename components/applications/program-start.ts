'use client';
// Turns a researched program into the user's own application rows. Every write goes through the user's session,
// so RLS and the existing triggers (default requirements, stage guard, ownership checks, XP) all still apply.
import type { SupabaseClient } from '@supabase/supabase-js';
import { must } from '@/lib/hooks';
import { CURRENCIES, NewApplicationSchema, zodFieldErrors } from '@/lib/applications';
import { essayRows, parseFee, parseIntake, requirementRows, type Program } from '@/lib/programs';

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
    const rows = requirementRows(program).map((r) => ({
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
export async function startProgramApplication(sb: SupabaseClient, input: { schoolId: string; program: Program; fallbackIntake?: string }): Promise<string> {
  const { schoolId, program } = input;
  const fee = parseFee(program.application_fee?.value, CURRENCIES);
  const parsed = NewApplicationSchema.safeParse({
    school_id: schoolId, program: program.program_name.slice(0, 120), intake: intakeFor(program, input.fallbackIntake).slice(0, 60), round: '', priority: 3,
    application_fee: fee ? String(fee.amount) : '', fee_currency: fee?.currency ?? 'USD', stage: 'researching', notes: '',
  });
  if (!parsed.success) throw new Error(Object.values(zodFieldErrors(parsed.error))[0] ?? 'Please check the program details');
  const { deadline_date: _d, deadline_time: _t, deadline_tz: _z, ...app } = parsed.data;
  const created = (await must(sb.from('applications').insert({ ...app, program_requirement_id: program.id }).select('id').single())) as { id: string };
  try {
    await applyProgramChecklist(sb, created.id, schoolId, program);
  } catch (e) {
    await sb.from('applications').delete().eq('id', created.id);
    throw new Error(`We could not set up the checklist, so the application was not created. ${e instanceof Error ? e.message : String(e)}`);
  }
  return created.id;
}
