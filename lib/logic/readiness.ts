export type ReqCategory = 'essays' | 'recommendations' | 'academics' | 'tests' | 'resume' | 'form' | 'other';
export type Req = { name: string; category: ReqCategory; status: string; mandatory: boolean };
export type Weights = Record<ReqCategory, number>;
export const DEFAULT_WEIGHTS: Weights = { essays: 25, recommendations: 20, academics: 15, tests: 10, resume: 10, form: 10, other: 10 };
const done = (r: Req) => r.status === 'complete' || r.status === 'waived';

/**
 * Readiness = weighted share of completed requirements per category.
 * Categories with no requirements are left out and the remaining weights are renormalised,
 * so an application is never penalised for a category it does not have.
 * Mandatory requirements that are not done are returned as blockers.
 */
export function readiness(reqs: Req[], weights: Weights = DEFAULT_WEIGHTS) {
  const cats = Object.keys(weights) as ReqCategory[];
  const byCategory: Partial<Record<ReqCategory, { done: number; total: number }>> = {};
  let weightSum = 0, score = 0;
  for (const c of cats) {
    const rs = reqs.filter((r) => r.category === c);
    if (!rs.length) continue;
    const d = rs.filter(done).length;
    byCategory[c] = { done: d, total: rs.length };
    weightSum += weights[c]; score += weights[c] * (d / rs.length);
  }
  const blockers = reqs.filter((r) => r.mandatory && !done(r));
  return { percent: weightSum === 0 ? 0 : Math.round((score / weightSum) * 100), byCategory, blockers, canBeReady: blockers.filter((b) => b.name !== 'Submission confirmation').length === 0 };
}
