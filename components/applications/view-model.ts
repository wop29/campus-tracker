// Shapes the rows loaded by the Applications page into what the list and the detail pane show.
import { submissionDeadline, type AppListRow, type Deadline, type DecisionStatus, type Requirement } from '@/lib/applications';
import { countWords } from '@/lib/logic/text';
import { checklistProgress, expectedResult, parseDecisionDates, phaseOf, programRounds, unlinkedRoundInfo, type RoundSource, roundTimeline, sortForList, type DecisionDates, type EssayLite, type ExpectedResult, type Phase, type Progress, type RoundStatus } from '@/lib/results';

type One<T> = T | T[] | null;
export type AppRow = Omit<AppListRow, 'decision'> & {
  decision: One<{ decision: DecisionStatus; decision_date: string | null }>;
  program_info: One<{ decision_dates: unknown; program_url: string | null; deadlines_info?: unknown }>;
};
export type { RoundSource };
export type EssayDraftRow = { id: string; draft: string | null; word_limit: number | null; application_id: string | null };
export type AppView = {
  row: AppRow; school: string; phase: Phase; progress: Progress<Requirement>; due: Deadline | null;
  dates: DecisionDates | null; result: ExpectedResult; decision: DecisionStatus | null; essays: Map<string, EssayLite>;
  /** The program's application rounds with a deadline date, oldest first, past ones closed. Empty when unknown. */
  rounds: RoundStatus[];
};
export const APP_SELECT = '*, school:schools(id,name,short_name,country,tier), deadlines(id,application_id,name,due_at,timezone,kind,is_primary), application_requirements(*), decision:admissions_decisions(decision,decision_date), program_info:program_requirements(decision_dates,program_url,deadlines_info:data->deadlines)';

const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function buildViews(rows: AppRow[], essays: EssayDraftRow[], now: Date = new Date(), sources: RoundSource[] = []): AppView[] {
  const essayMap = new Map<string, EssayLite>(essays.map((e) => [e.id, { id: e.id, words: countWords(e.draft ?? ''), word_limit: e.word_limit }]));
  const views = rows.map((row): AppView => {
    const info = one(row.program_info) ?? unlinkedRoundInfo(row, sources);
    const dates = parseDecisionDates(info?.decision_dates);
    const reqs = [...(row.application_requirements ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    return {
      row, school: row.school?.name ?? 'Unknown school', phase: phaseOf(row.stage), progress: checklistProgress(reqs), due: submissionDeadline(row.deadlines ?? [], now), dates,
      result: expectedResult({ dates, submittedOn: row.submitted_at, chosenRound: row.result_round, ownDate: row.expected_result_on, now }),
      decision: one(row.decision)?.decision ?? null, essays: essayMap,
      rounds: roundTimeline(programRounds(info?.decision_dates, info?.deadlines_info), now),
    };
  });
  const order = sortForList(views.map((v) => ({ stage: v.row.stage, dueAt: v.due?.due_at ?? null, resultDate: v.result.date, v })));
  return order.map((o) => o.v);
}
