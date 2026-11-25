// Scholarships tab: every scholarship and fee waiver from the researched programs, grouped and flagged against the
// student's plan (Settings > Your plan). Pure logic only: no React, no Supabase. Tested in tests/aid.test.ts.
import { parsePrograms, sanitizeText } from './programs.ts';
import { SCHOOL_PLACES, isUndergradRow, type Level } from './catalogue.ts';
import { DESTINATION_LABEL, type Onboarding } from './onboarding.ts';

export type AidKind = 'scholarship' | 'fee_waiver' | 'government';
export type Fit = 'good' | 'check' | 'no';
export type AidEntry = {
  key: string; kind: AidKind; name: string; school: string | null; programs: string[]; country: string | null; level: Level;
  amount: string | null; eligibility: string | null; internationalOk: boolean | null; sourceUrl: string | null;
};
export type FitResult = { fit: Fit; reasons: string[] };
export type AidProfile = { level: Level; countries: string[]; funding?: string; status?: string; onList: Set<string> };

/** LPDP is the main Indonesian government scholarship for master's and doctoral study abroad. Always check the official list. */
export const LPDP_ENTRY: AidEntry = {
  key: 'gov:lpdp', kind: 'government', name: 'LPDP scholarship (Indonesian government)', school: null, programs: ["Master's and doctoral programs"],
  country: null, level: 'grad', amount: 'Tuition and living costs, as set in the LPDP guidebook for your year',
  eligibility: 'Indonesian citizens applying to universities on the LPDP list. LPDP asks for an offer letter (LoA) from the university, so check which LoA types it accepts for your round.',
  internationalOk: true, sourceUrl: 'https://lpdp.kemenkeu.go.id/',
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

/** Every scholarship and fee waiver in the catalogue, one entry per school and name (program names merged). */
export function buildAid(rows: unknown): AidEntry[] {
  const raw = Array.isArray(rows) ? rows : [];
  const levels = new Map<string, Level>();
  for (const r of raw) if (r && typeof r === 'object' && 'id' in r) levels.set(String((r as { id: unknown }).id), isUndergradRow(r as never) ? 'undergrad' : 'grad');
  const countries = new Map<string, string | null>();
  for (const r of raw) {
    if (!r || typeof r !== 'object' || !('id' in r)) continue;
    const d = (r as { data?: unknown }).data;
    const c = d && typeof d === 'object' && typeof (d as { country?: unknown }).country === 'string' ? (d as { country: string }).country : null;
    countries.set(String((r as { id: unknown }).id), c);
  }
  const byKey = new Map<string, AidEntry>();
  const add = (e: AidEntry, program: string) => {
    const cur = byKey.get(e.key);
    if (cur) { if (!cur.programs.includes(program)) cur.programs.push(program); return; }
    byKey.set(e.key, { ...e, programs: [program] });
  };
  for (const p of parsePrograms(raw)) {
    const level = levels.get(p.id) ?? 'grad';
    const country = SCHOOL_PLACES[p.school]?.country ?? countries.get(p.id) ?? null;
    for (const s of p.scholarships) {
      const name = sanitizeText(s.name);
      if (!name) continue;
      add({
        key: `s:${norm(p.school)}:${norm(name)}:${level}`, kind: 'scholarship', name, school: p.school, programs: [], country, level,
        amount: cleanAmount(s.amount), eligibility: sanitizeText(s.eligibility), internationalOk: s.international_ok, sourceUrl: s.source_url,
      }, p.program_name);
    }
    if (p.fee_waiver?.value) {
      const text = sanitizeText(p.fee_waiver.value);
      if (text) add({
        key: `w:${norm(p.school)}:${norm(text).slice(0, 80)}:${level}`, kind: 'fee_waiver', name: `${p.school} application fee waiver`, school: p.school,
        programs: [], country, level, amount: 'Application fee waived', eligibility: text, internationalOk: null, sourceUrl: p.fee_waiver.source_url,
      }, p.program_name);
    }
  }
  return [...byKey.values()];
}

/** "amount not published" and similar become null so the card can say it plainly. */
export function cleanAmount(v: string | null): string | null {
  const t = sanitizeText(v);
  if (!t) return null;
  return /not (published|stated|listed)|^n\/?a$|unknown/i.test(t) ? null : t;
}

const RESTRICTED = /\b(u\.?s\.? (citizens?|permanent residents?)|green card|domestic (students|applicants)|home (fee )?students|uk (residents|nationals)|eu (citizens|nationals)|canadian citizens|australian citizens|permanent residents? of|daca)\b/i;
const REGION = /\b(south ?east asia|asean|indonesia|asia(n)?|asia[- ]pacific|developing (countr|econom)|emerging (market|econom)|low[- ] and middle[- ]income|overseas development|official development assistance)\b/i;
const ALL_ADMITTED = /\b(all (admitted|applicants|candidates|students)|automatically considered|every admitted|no separate application)\b/i;
const NEED = /\b(need[- ]based|financial need|financial circumstances|demonstrated need|hardship)\b/i;
const WOMEN = /\b(women|female)\b/i;
const MILITARY = /\b(military|veterans?|armed forces|service members?)\b/i;

/** How well an entry fits the student's plan, with plain reasons. Text matching is a hint, never a promise. */
export function fitFor(e: AidEntry, p: AidProfile): FitResult {
  const reasons: string[] = [];
  const text = `${e.name} ${e.eligibility ?? ''}`;
  if (e.level !== p.level) return { fit: 'no', reasons: [e.level === 'grad' ? 'For graduate students' : 'For undergraduates'] };
  if (e.kind === 'government') {
    if (p.funding === 'lpdp') return { fit: 'good', reasons: ['You said you plan to use LPDP'] };
    return { fit: 'good', reasons: ['For Indonesian citizens'] };
  }
  if (e.internationalOk === false) return { fit: 'no', reasons: ['Not open to international students'] };
  if (RESTRICTED.test(text) && !REGION.test(text)) return { fit: 'no', reasons: ['Only for citizens or residents of another country'] };
  if (MILITARY.test(text) && !NEED.test(text) && !REGION.test(text)) return { fit: 'check', reasons: ['Seems to be for military or veterans'] };

  let fit: Fit = 'check';
  if (REGION.test(text)) { fit = 'good'; reasons.push('Open to students from Indonesia or Southeast Asia'); }
  if (ALL_ADMITTED.test(text)) { fit = 'good'; reasons.push('Every admitted student is considered'); }
  if (NEED.test(text)) {
    if (p.funding === 'need' || p.funding === 'unsure') { fit = 'good'; reasons.push('Based on financial need, and you said you need support'); }
    else reasons.push('Based on financial need');
  }
  if (e.kind === 'scholarship' && e.internationalOk === true && fit !== 'good') { fit = 'good'; reasons.push('Open to international students'); }
  if (WOMEN.test(text)) { if (fit === 'good') fit = 'check'; reasons.push('For women applicants'); }
  if (e.country && p.countries.includes(e.country)) reasons.push(`In ${e.country}, a country you picked`);
  if (e.school && p.onList.has(norm(e.school))) reasons.push('School is on your list');
  if (fit === 'check' && !reasons.some((r) => r.startsWith('For') || r.startsWith('Seems'))) reasons.unshift('Eligibility is not clearly stated');
  return { fit, reasons };
}

export function aidProfile(ob: Onboarding, onListNames: string[]): AidProfile {
  return {
    level: ob.track, countries: ob.destinations.map((d) => DESTINATION_LABEL[d]),
    ...(ob.about?.funding ? { funding: ob.about.funding } : {}), ...(ob.about?.status ? { status: ob.about.status } : {}),
    onList: new Set(onListNames.map(norm)),
  };
}

export type AidFilter = { level: Level; countries: string[]; q: string; fitsOnly: boolean; kinds: AidKind[] };
export type RankedAid = AidEntry & FitResult;

const FIT_ORDER: Record<Fit, number> = { good: 0, check: 1, no: 2 };
/** Filters, flags and sorts: good fits first, then schools on the list, then countries picked, then name. */
export function rankAid(entries: AidEntry[], profile: AidProfile, f: AidFilter): RankedAid[] {
  const q = norm(f.q);
  const all = [LPDP_ENTRY, ...entries]
    .filter((e) => e.level === f.level)
    .filter((e) => f.kinds.includes(e.kind))
    .filter((e) => !f.countries.length || e.country === null || f.countries.includes(e.country))
    .filter((e) => !q || norm(`${e.name} ${e.school ?? ''} ${e.programs.join(' ')} ${e.eligibility ?? ''}`).includes(q))
    .map((e) => ({ ...e, ...fitFor(e, profile) }))
    .filter((e) => !f.fitsOnly || e.fit !== 'no');
  const score = (e: RankedAid) => FIT_ORDER[e.fit] * 10 - (e.reasons.includes('School is on your list') ? 2 : 0) - (e.reasons.some((r) => r.includes('a country you picked')) ? 1 : 0) - (e.kind === 'government' ? 5 : 0);
  return all.sort((a, b) => score(a) - score(b) || (a.school ?? '').localeCompare(b.school ?? '') || a.name.localeCompare(b.name));
}
