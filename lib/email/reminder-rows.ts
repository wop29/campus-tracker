// Loads the rows the reminder decision needs (lib/reminders.ts: ReminderRows), grouped by user.
// No secrets here, so the same code serves two callers:
//  * the cron (service role client, which bypasses RLS: every query is filtered by user_id), and
//  * the Settings preview in the browser (the signed-in user's own client: RLS returns only their rows).
// Newer columns are read defensively: when a column or table does not exist yet, that part is simply left empty.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LogEntry, ReminderRows } from '@/lib/reminders';

const PAGE = 1000;
export type Q = { range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }> };
/** Reads every page of a query (PostgREST returns at most 1000 rows per request). */
export async function all<T>(make: () => Q, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 50 * PAGE; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
/** True for "that column or table is not there (yet)" errors from Postgres or PostgREST. */
export const isMissingSchema = (message: string) => /does not exist|schema cache|could not find|42703|42P01|PGRST20[045]/i.test(message);
/** Runs `full`; when it fails because a column or table is missing, runs `fallback` instead (or returns nothing). */
async function tolerant<T>(full: () => Promise<T[]>, fallback?: () => Promise<T[]>): Promise<T[]> {
  try { return await full(); } catch (e) {
    if (!isMissingSchema((e as Error).message)) throw e;
    return fallback ? fallback() : [];
  }
}

export const HISTORY_DAYS = 40; // longer than the 3 week nudge cadence plus its grace week
const CHUNK = 25;
type U<T> = T & { user_id: string };
const emptyRows = (): ReminderRows => ({ schools: [], applications: [], deadlines: [], requirements: [], decisions: [], decisionDates: {}, activityAt: [], history: [] });

/** reminder_log rows on or after `since` (YYYY-MM-DD), grouped by user. Works before migration 024 (kind is then null). */
export async function loadReminderHistory(sb: SupabaseClient, ids: string[], since: string): Promise<Map<string, LogEntry[]>> {
  const out = new Map<string, LogEntry[]>();
  for (let i = 0; i < ids.length; i += 100) {
    const q = (cols: string) => () => all<{ user_id: string; sent_on: string; kind?: string | null }>(() => sb.from('reminder_log').select(cols).in('user_id', ids.slice(i, i + 100)).gte('sent_on', since).order('user_id').order('sent_on') as unknown as Q, 'reminder_log');
    const rows = await tolerant(q('user_id,sent_on,kind'), q('user_id,sent_on'));
    for (const r of rows) out.set(r.user_id, [...(out.get(r.user_id) ?? []), { sentOn: r.sent_on, kind: r.kind ?? null }]);
  }
  return out;
}

/** Everything decideReminder needs for these users, with a handful of paged queries per chunk of 25 users. */
export async function loadReminderRows(sb: SupabaseClient, ids: string[], now: Date, history?: Map<string, LogEntry[]>): Promise<Map<string, ReminderRows>> {
  const out = new Map<string, ReminderRows>();
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000).toISOString();
  const hist = history ?? await loadReminderHistory(sb, ids, since.slice(0, 10));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const get = <T>(table: string, cols: string, opts: { notDeleted?: boolean; sinceCol?: string } = {}) => all<U<T>>(() => {
      let b = sb.from(table).select(`user_id,${cols}`).in('user_id', chunk);
      if (opts.notDeleted) b = b.is('deleted_at', null);
      if (opts.sinceCol) b = b.gte(opts.sinceCol, since);
      return b.order('id') as unknown as Q;
    }, table);
    const appCols = 'id,school_id,stage,round,submission_confirmed_at,submitted_at';
    const [schools, apps, deadlines, reqs, decisions, xp, essays] = await Promise.all([
      get<ReminderRows['schools'][number]>('schools', 'id,name,short_name', { notDeleted: true }),
      tolerant(
        () => get<ReminderRows['applications'][number]>('applications', `${appCols},program_requirement_id,expected_result_on`, { notDeleted: true }),
        () => tolerant(
          () => get<ReminderRows['applications'][number]>('applications', `${appCols},program_requirement_id`, { notDeleted: true }),
          () => get<ReminderRows['applications'][number]>('applications', appCols, { notDeleted: true }),
        ),
      ),
      get<ReminderRows['deadlines'][number]>('deadlines', 'id,application_id,name,due_at,timezone,kind,is_primary'),
      get<ReminderRows['requirements'][number]>('application_requirements', 'id,application_id,name,category,status,mandatory,sort_order,completed_at,updated_at'),
      get<ReminderRows['decisions'][number]>('admissions_decisions', 'id,application_id,decision'),
      tolerant(() => get<{ occurred_at: string }>('xp_events', 'id,occurred_at', { sinceCol: 'occurred_at' })),
      tolerant(() => get<{ updated_at: string }>('essays', 'id,updated_at', { notDeleted: true, sinceCol: 'updated_at' })),
    ]);

    // Expected result dates per researched program (program_requirements.decision_dates). Missing column: no dates.
    const programIds = [...new Set(apps.map((a) => a.program_requirement_id).filter((x): x is string => Boolean(x)))];
    const decisionDates: Record<string, unknown> = {};
    for (let j = 0; j < programIds.length; j += 100) {
      const rows = await tolerant(() => all<{ id: string; decision_dates: unknown }>(() => sb.from('program_requirements').select('id,decision_dates').in('id', programIds.slice(j, j + 100)).order('id') as unknown as Q, 'program_requirements'));
      for (const r of rows) if (r.decision_dates != null) decisionDates[r.id] = r.decision_dates;
    }

    for (const uid of chunk) {
      const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === uid);
      const applications = mine(apps);
      const live = new Set(applications.map((a) => a.id));
      const ofLive = <T extends { user_id: string; application_id: string }>(rows: T[]) => mine(rows).filter((r) => live.has(r.application_id));
      out.set(uid, {
        ...emptyRows(),
        schools: mine(schools), applications, deadlines: ofLive(deadlines), requirements: ofLive(reqs), decisions: ofLive(decisions),
        decisionDates: Object.fromEntries(applications.map((a) => a.program_requirement_id).filter((x): x is string => Boolean(x) && x! in decisionDates).map((id) => [id, decisionDates[id]])),
        activityAt: [...mine(xp).map((x) => x.occurred_at), ...mine(essays).map((e) => e.updated_at)],
        history: hist.get(uid) ?? [],
      });
    }
  }
  return out;
}
