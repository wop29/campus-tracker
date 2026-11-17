export type SearchSchool = { id: string; name: string; short_name: string | null; country: string | null; location: string | null; tier: string | null; in_portfolio: boolean; notes: string | null };
export type SearchApp = { id: string; school_id: string; program: string; intake: string; round: string | null; stage: string; notes: string | null };
export type SearchEssay = { id: string; title: string; status: string; school_id: string | null; application_id: string | null };

/** Lowercases and strips accents so "Said" finds "Saïd". */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const tokens = (q: string) => normalize(q).split(/\s+/).filter(Boolean);
const matches = (hay: (string | null | undefined)[], toks: string[]) => { const h = normalize(hay.filter(Boolean).join(' | ')); return toks.every((t) => h.includes(t)); };

export type SearchResults = { schools: SearchSchool[]; applications: (SearchApp & { schoolName: string })[]; essays: (SearchEssay & { schoolName: string | null })[] };
/** Every word of the query must appear (any order) in the searched fields. Empty query returns nothing. */
export function searchAll(q: string, d: { schools: SearchSchool[]; applications: SearchApp[]; essays: SearchEssay[] }): SearchResults {
  const toks = tokens(q);
  if (!toks.length) return { schools: [], applications: [], essays: [] };
  const byId = new Map(d.schools.map((s) => [s.id, s]));
  const nameOf = (id: string | null) => (id ? byId.get(id)?.name ?? null : null);
  const rank = (name: string) => (normalize(name).startsWith(toks[0]) ? 0 : 1);
  return {
    schools: d.schools.filter((s) => matches([s.name, s.short_name, s.country, s.location, s.tier, s.notes], toks)).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)),
    applications: d.applications.map((a) => ({ ...a, schoolName: nameOf(a.school_id) ?? 'Unknown school' }))
      .filter((a) => matches([a.schoolName, byId.get(a.school_id)?.short_name, a.program, a.intake, a.round, a.stage.replace(/_/g, ' '), a.notes], toks)).sort((a, b) => a.schoolName.localeCompare(b.schoolName)),
    essays: d.essays.map((e) => ({ ...e, schoolName: nameOf(e.school_id) })).filter((e) => matches([e.title, e.schoolName], toks)).sort((a, b) => a.title.localeCompare(b.title)),
  };
}
