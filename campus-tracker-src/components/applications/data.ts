'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { decisionForStage, friendlyDbError, LETTER_TITLE, resolveWeights, wallToIso, type Application, type Deadline, type DeadlineKind, type Decision, type Requirement, type School, type Task } from '@/lib/applications';
import type { Weights } from '@/lib/logic/readiness';
import type { Stage } from '@/lib/constants';

/** Runs a write with a double-submit guard, surfaces errors verbatim (trigger messages included) and toasts on success. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useCallback(async (fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> => {
    if (lock.current) return false;
    lock.current = true; setBusy(true);
    try { await fn(); if (okMsg) toast(okMsg); return true; }
    catch (e) { toast(friendlyDbError(e instanceof Error ? e.message : String(e)), 'err'); return false; }
    finally { lock.current = false; setBusy(false); }
  }, [toast]);
  return { busy, run };
}

/** Readiness weights from applicant_profiles.settings.readiness_weights, else defaults. */
export function useWeights() {
  const [weights, setWeights] = useState<Weights>(resolveWeights(null));
  const [custom, setCustom] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabaseBrowser().from('applicant_profiles').select('settings').maybeSingle();
    const s = (data as { settings?: { readiness_weights?: unknown } } | null)?.settings;
    setWeights(resolveWeights(s)); setCustom(!!s?.readiness_weights);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { weights, custom, reload: load };
}
/** Merges readiness_weights into settings without touching other keys. */
export async function saveWeights(w: Weights | null) {
  const sb = supabaseBrowser();
  const { data } = await sb.from('applicant_profiles').select('id, settings').maybeSingle();
  const row = data as { id: string; settings: Record<string, unknown> } | null;
  const settings = { ...(row?.settings ?? {}) } as Record<string, unknown>;
  if (w) settings.readiness_weights = w; else delete settings.readiness_weights;
  if (row) await must(sb.from('applicant_profiles').update({ settings }).eq('id', row.id));
  else await must(sb.from('applicant_profiles').insert({ settings }));
}

export type EssayRow = { id: string; title: string; draft: string; word_limit: number | null; status: string; application_id: string | null; latest_version: number | null };
export type RecRow = { id: string; status: string; deadline: string | null; submitted_at: string | null; recommender: { name: string } | null };
export type DocRow = { id: string; name: string; category: string };
export type DocVersionRow = { id: string; document_id: string; version_number: number; file_name: string };
export type InterviewRow = { id: string; scheduled_at: string | null; status: string; interviewer: string | null; format: string | null };
export type AchievementRow = { id: string; title: string; description: string | null };
export type Bundle = {
  app: Application & { school: School | null }; programDurationMonths: number | null;
  reqs: Requirement[]; deadlines: Deadline[]; tasks: Task[]; decision: Decision | null;
  essays: EssayRow[]; letter: EssayRow | null; recs: RecRow[]; docs: DocRow[]; docVersions: DocVersionRow[];
  hasTestScores: boolean; feePaid: boolean; interviews: InterviewRow[]; achievements: AchievementRow[];
};

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function loadBundle(id: string): Promise<Bundle | null> {
  const sb = supabaseBrowser();
  const appRow = await must(sb.from('applications').select('*, school:schools(id,name,short_name,country,tier,location)').eq('id', id).is('deleted_at', null).maybeSingle());
  if (!appRow) return null;
  const app = appRow as Bundle['app'];
  const [reqs, deadlines, tasks, decision, essayRows, recs, docs, tests, fees, interviews, ach, programs] = await Promise.all([
    must(sb.from('application_requirements').select('*').eq('application_id', id).order('sort_order').order('created_at')),
    must(sb.from('deadlines').select('*').eq('application_id', id).order('due_at')),
    must(sb.from('application_tasks').select('*').eq('application_id', id).order('created_at')),
    must(sb.from('admissions_decisions').select('*').eq('application_id', id).maybeSingle()),
    must(sb.from('essays').select('id,title,draft,word_limit,status,application_id').eq('application_id', id).is('deleted_at', null).order('created_at')),
    must(sb.from('recommendations').select('id,status,deadline,submitted_at,recommender:recommenders(name)').eq('application_id', id)),
    must(sb.from('documents').select('id,name,category').is('deleted_at', null).order('name')),
    must(sb.from('test_scores').select('id').is('deleted_at', null).limit(1)),
    must(sb.from('expenses').select('id').eq('application_id', id).eq('category', 'application_fee').eq('payment_status', 'paid').is('deleted_at', null)),
    must(sb.from('interview_sessions').select('id,scheduled_at,status,interviewer,format').eq('application_id', id).eq('kind', 'real').order('scheduled_at')),
    must(sb.from('achievements').select('id,title,description').eq('source_type', 'waitlist_update').eq('source_id', id).is('deleted_at', null).order('created_at')),
    must(sb.from('school_programs').select('name,duration_months').eq('school_id', app.school_id)),
  ]);
  const allEssays = (essayRows ?? []) as Omit<EssayRow, 'latest_version'>[];
  const vers = allEssays.length ? ((await must(sb.from('essay_versions').select('essay_id,version_number').in('essay_id', allEssays.map((e) => e.id)))) ?? []) as { essay_id: string; version_number: number }[] : [];
  const latest = new Map<string, number>();
  for (const v of vers) latest.set(v.essay_id, Math.max(latest.get(v.essay_id) ?? 0, v.version_number));
  const withV = allEssays.map((e) => ({ ...e, latest_version: latest.get(e.id) ?? null }));
  const resumeDocs = ((docs ?? []) as DocRow[]).filter((d) => d.category === 'resume').map((d) => d.id);
  const docVersions = resumeDocs.length ? (((await must(sb.from('document_versions').select('id,document_id,version_number,file_name').in('document_id', resumeDocs).order('version_number', { ascending: false }))) ?? []) as DocVersionRow[]) : [];
  const progs = (programs ?? []) as { name: string; duration_months: number | null }[];
  const prog = progs.find((p) => p.name.toLowerCase() === app.program.toLowerCase()) ?? (progs.length === 1 ? progs[0] : null);
  return {
    app, programDurationMonths: prog?.duration_months ?? null,
    reqs: (reqs ?? []) as Requirement[], deadlines: (deadlines ?? []) as Deadline[], tasks: (tasks ?? []) as Task[], decision: one(decision as Decision | null),
    essays: withV.filter((e) => e.title !== LETTER_TITLE), letter: withV.find((e) => e.title === LETTER_TITLE) ?? null,
    recs: ((recs ?? []) as unknown as { id: string; status: string; deadline: string | null; submitted_at: string | null; recommender: { name: string } | { name: string }[] | null }[]).map((r) => ({ ...r, recommender: one(r.recommender) })),
    docs: (docs ?? []) as DocRow[], docVersions,
    hasTestScores: ((tests ?? []) as unknown[]).length > 0,
    feePaid: ((fees ?? []) as unknown[]).length > 0, interviews: (interviews ?? []) as InterviewRow[], achievements: (ach ?? []) as AchievementRow[],
  };
}

/** Changes the stage (DB triggers guard Ready and Submitted) and keeps admissions_decisions consistent with it. */
export async function changeStage(appId: string, target: Stage) {
  const sb = supabaseBrowser();
  await must(sb.from('applications').update({ stage: target }).eq('id', appId));
  const d = decisionForStage(target);
  if (d) await must(sb.from('admissions_decisions').upsert({ application_id: appId, decision: d }, { onConflict: 'application_id' }));
}
/** Creates the single decision row for an application if missing, then applies the patch. */
export async function patchDecision(appId: string, patch: Record<string, unknown>) {
  await must(supabaseBrowser().from('admissions_decisions').upsert({ application_id: appId, ...patch }, { onConflict: 'application_id' }));
}
/** Creates, updates or (when date is empty) removes the deadline row identified by kind + name. */
export async function syncDeadline(appId: string, kind: DeadlineKind, name: string, date: string, time = '23:59', tz = 'America/New_York') {
  const sb = supabaseBrowser();
  const rows = ((await must(sb.from('deadlines').select('id').eq('application_id', appId).eq('kind', kind).eq('name', name))) ?? []) as { id: string }[];
  if (!date) { if (rows.length) await must(sb.from('deadlines').delete().in('id', rows.map((r) => r.id))); return; }
  const payload = { due_at: wallToIso(date, time, tz), timezone: tz };
  if (rows.length) await must(sb.from('deadlines').update(payload).eq('id', rows[0].id));
  else await must(sb.from('deadlines').insert({ application_id: appId, kind, name, is_primary: false, ...payload }));
}

export type TabProps = { b: Bundle; reload: () => void; weights: Weights };
