export type SearchSchool = { id: string; name: string; short_name: string | null; country: string | null; location: string | null; tier: string | null; in_portfolio: boolean; notes: string | null };
export type SearchApp = { id: string; school_id: string; program: string; intake: string; round: string | null; stage: string; notes: string | null };
export type SearchEssay = { id: string; title: string; status: string; school_id: string | null; application_id: string | null };
/**
 * A researched program (public.program_requirements), selected with only the fields search needs.
 * The subject keys are optional parts of `data` that research agents may fill; any of them can be missing or odd.
 */
export type SearchProgram = {
  id: string; school_name: string; program_name: string; degree_type: string | null; format?: string | null;
  subjects?: unknown; subject?: unknown; field?: unknown; majors?: unknown; concentrations?: unknown;
};

/** Lowercases and strips accents so "Said" finds "Saïd". */
export const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const tokens = (q: string) => normalize(q).split(/\s+/).filter(Boolean);
const matches = (hay: (string | null | undefined)[], toks: string[]) => { const h = normalize(hay.filter(Boolean).join(' | ')); return toks.every((t) => h.includes(t)); };

/** Student-facing degree label. Unknown values fall back to null so the UI can leave it out. */
export const DEGREE_SEARCH_LABEL: Record<string, string> = { mba: 'MBA', masters: "Master's", undergrad: "Bachelor's", phd: 'PhD', other: 'Other degree' };
/** Extra words a student might type for each degree type (searched, never shown). */
const DEGREE_SYNONYMS: Record<string, string> = {
  mba: 'mba business administration graduate',
  masters: "master's masters master msc ms ma graduate postgraduate",
  undergrad: "bachelor's bachelors bachelor undergraduate undergrad ba bsc degree",
  phd: 'phd doctorate doctoral',
};

/** Subjects of a program from whichever optional key holds them (string, list of strings, or nothing). Deduplicated, max 8. */
export function programSubjects(p: SearchProgram): string[] {
  const out: string[] = []; const seen = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string') { for (const part of v.split(/[;,\n]/)) { const t = part.trim().slice(0, 80); const k = normalize(t); if (t && !seen.has(k)) { seen.add(k); out.push(t); } } }
    else if (Array.isArray(v)) v.forEach((x) => { if (typeof x === 'string') add(x); });
  };
  [p.subjects, p.subject, p.field, p.majors, p.concentrations].forEach(add);
  return out.slice(0, 8);
}

export type ProgramHit = SearchProgram & { degreeLabel: string | null; subjectList: string[]; schoolId: string | null };
export type SearchResults = {
  schools: SearchSchool[]; programs: ProgramHit[]; programsTotal: number;
  applications: (SearchApp & { schoolName: string })[]; essays: (SearchEssay & { schoolName: string | null })[];
};
export type SearchData = { schools: SearchSchool[]; applications: SearchApp[]; essays: SearchEssay[]; programs?: SearchProgram[] };
/** Most programs listed at once; the rest are counted so the page can say "and N more". */
export const MAX_PROGRAM_HITS = 30;

/** Every word of the query must appear (any order) in the searched fields. Empty query returns nothing. */
export function searchAll(q: string, d: SearchData): SearchResults {
  const toks = tokens(q);
  if (!toks.length) return { schools: [], programs: [], programsTotal: 0, applications: [], essays: [] };
  const byId = new Map(d.schools.map((s) => [s.id, s]));
  const nameOf = (id: string | null) => (id ? byId.get(id)?.name ?? null : null);
  const rank = (name: string) => (normalize(name).startsWith(toks[0]) ? 0 : 1);
  // A researched program links to the student's own school record when the names match.
  const byName = new Map<string, string>();
  for (const s of d.schools) for (const n of [s.name, s.short_name]) if (n) byName.set(normalize(n.trim()), s.id);
  const allPrograms = (d.programs ?? []).map((p): ProgramHit => ({
    ...p, degreeLabel: p.degree_type ? DEGREE_SEARCH_LABEL[p.degree_type] ?? null : null, subjectList: programSubjects(p), schoolId: byName.get(normalize(p.school_name.trim())) ?? null,
  })).filter((p) => matches([p.program_name, p.school_name, p.degreeLabel, p.degree_type ? DEGREE_SYNONYMS[p.degree_type] : null, p.format, ...p.subjectList], toks));
  // Programs whose own name or subjects contain the words come before ones that only match on the school name.
  const own = (p: ProgramHit) => (matches([p.program_name, ...p.subjectList], toks) ? 0 : 1);
  allPrograms.sort((a, b) => own(a) - own(b) || (a.schoolId ? 0 : 1) - (b.schoolId ? 0 : 1) || a.school_name.localeCompare(b.school_name) || a.program_name.localeCompare(b.program_name));
  return {
    schools: d.schools.filter((s) => matches([s.name, s.short_name, s.country, s.location, s.tier, s.notes], toks)).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)),
    programs: allPrograms.slice(0, MAX_PROGRAM_HITS), programsTotal: allPrograms.length,
    applications: d.applications.map((a) => ({ ...a, schoolName: nameOf(a.school_id) ?? 'Unknown school' }))
      .filter((a) => matches([a.schoolName, byId.get(a.school_id)?.short_name, a.program, a.intake, a.round, a.stage.replace(/_/g, ' '), a.notes], toks)).sort((a, b) => a.schoolName.localeCompare(b.schoolName)),
    essays: d.essays.map((e) => ({ ...e, schoolName: nameOf(e.school_id) })).filter((e) => matches([e.title, e.schoolName], toks)).sort((a, b) => a.title.localeCompare(b.title)),
  };
}

/** Columns selected from program_requirements for search: names plus the optional subject keys, never the full data blob. */
export const PROGRAM_SEARCH_COLS = 'id,school_name,program_name,degree_type,format,subjects:data->subjects,subject:data->subject,field:data->field,majors:data->majors,concentrations:data->concentrations';
