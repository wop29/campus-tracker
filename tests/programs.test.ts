import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  clearlyOptional, compareScores, englishSummary, gmatEdition, minimumScore, parseClassProfile, parseEmployment, parseGreRange, parseRange, essayRows, essayTitle, groupChecklist, parseFee, parseIntake, parseProgram, parsePrograms, parseWordLimit,
  programsForTrack, requirementChecklist, requirementRows, safeUrl, type Program, type ProgramRow,
} from '../lib/programs.ts';
import { REQ_CATEGORIES, CURRENCIES } from '../lib/applications.ts';
import { englishChips } from '../lib/programs.ts';

// Fixtures follow the research spec shape. Values are taken from the official pages already cited in migration 019.
const GSB = 'https://www.gsb.stanford.edu/programs/mba/admission';
const stanfordData = {
  school: 'Stanford GSB', program_name: 'Stanford MBA', degree_type: 'mba', format: 'full-time', duration: '2 years', intake: 'Fall 2027 (September)',
  program_url: 'https://www.gsb.stanford.edu/programs/mba',
  deadlines: { value: '2026-27 cycle: Round 1 Sep 9, 2026; Round 2 Jan 6, 2027; Round 3 Apr 7, 2027 (4:00 pm PT)', source_url: `${GSB}/deadlines` },
  application_fee: { value: 'USD 275', source_url: `${GSB}/application/fee` },
  tests: { value: 'GMAT or GRE required; no minimum score and no preference between tests. Executive Assessment not accepted.', source_url: `${GSB}/application/application-essentials` },
  english: { ielts_min: null, toefl_min: null, duolingo: 'not accepted', pte_min: null, other_tests: null, waiver: 'Not required if a later graduate program was taught exclusively in English', source_url: `${GSB}/application/application-essentials` },
  essays: { items: [
    { prompt: 'What matters most to you, and why?', limit: 'up to 650 words', required: true },
    { prompt: 'Why Stanford for you?', limit: '350 words', required: true },
  ], source_url: `${GSB}/application/essays` },
  video_assessment: { value: 'none required', source_url: `${GSB}/application/application-essentials` },
  interview: { value: 'By invitation only; structured behavioral interview, remote or in person, with an alumni or admissions-staff interviewer.', source_url: `${GSB}/interviews` },
  recommendations: { value: 'Two letters: one from your current direct supervisor, one from another person who supervised you.', source_url: `${GSB}/application/letters-recommendation` },
  other_requirements: { value: 'Resume, transcripts from every university attended, short-answer questions.', source_url: `${GSB}/application/application-essentials` },
  notes: 'Upload unofficial transcripts with the application; official ones only if admitted.',
};
const row = (data: unknown, extra: Partial<ProgramRow> = {}): ProgramRow => ({
  id: 'p1', school_name: 'Stanford GSB', program_name: 'Stanford MBA', degree_type: 'mba', format: 'full-time', duration: '2 years', intake: 'Fall 2027 (September)',
  program_url: 'https://www.gsb.stanford.edu/programs/mba', data, collected_on: '2026-11-16', ...extra,
});
const stanford = parseProgram(row(stanfordData))!;
const kelloggData = {
  school: 'Kellogg', program_name: 'Two-Year MBA', degree_type: 'mba', format: 'full-time', duration: '2 years', intake: 'Fall 2027',
  program_url: 'https://www.kellogg.northwestern.edu/admissions/ft-admissions/ft-how-to-apply/',
  tests: { value: 'GMAT or GRE required from a single sitting; no minimum score', source_url: 'https://www.kellogg.northwestern.edu/admissions/ft-admissions/ft-how-to-apply/' },
  english: { ielts_min: '7.0', toefl_min: '100 iBT', duolingo: 'accepted (min 125)', pte_min: null, other_tests: null, waiver: null, source_url: 'https://www.kellogg.northwestern.edu/admissions/ft-admissions/ft-how-to-apply/' },
  essays: { items: [{ prompt: 'Tell us about the pivotal experiences and decisions that have brought you to this moment in your career.', limit: '550 words', required: true }], source_url: 'https://www.kellogg.northwestern.edu/admissions/ft-admissions/ft-how-to-apply/' },
  video_assessment: { value: 'Video essay: five questions, up to one minute each, after submitting the application.', source_url: 'https://www.kellogg.northwestern.edu/admissions/ft-admissions/ft-how-to-apply/' },
  interview: null, recommendations: null, other_requirements: null, deadlines: null, application_fee: null, notes: null,
};
const kellogg = parseProgram(row(kelloggData, { id: 'p2', school_name: 'Kellogg', program_name: 'Two-Year MBA', intake: 'Fall 2027' }))!;

test('parseProgram reads the spec shape and rejects unusable rows', () => {
  assert.equal(stanford.program_name, 'Stanford MBA'); assert.equal(stanford.degree_type, 'mba'); assert.equal(stanford.essays?.items.length, 2);
  assert.equal(stanford.english?.duolingo, 'not accepted');
  assert.equal(parseProgram(null), null);
  assert.equal(parseProgram(row({}, { program_name: '', school_name: '' })), null);
  const junk = parseProgram(row({ essays: { items: [null, 5, { prompt: '' }, 'Plain string prompt'] }, tests: 42, english: 'yes', deadlines: { value: '' } }));
  assert.ok(junk); assert.deepEqual(junk.essays?.items, [{ prompt: 'Plain string prompt', limit: null, required: true }]);
  assert.equal(junk.english, null); assert.equal(junk.deadlines, null); assert.equal(junk.tests, null);
  assert.equal(parsePrograms('nope').length, 0); assert.equal(parsePrograms([row(stanfordData), null]).length, 1);
});
test('only http(s) source links survive', () => {
  assert.equal(safeUrl('javascript:alert(1)'), null); assert.equal(safeUrl('https://x.edu/a'), 'https://x.edu/a'); assert.equal(safeUrl(' '), null);
  const p = parseProgram(row({ ...stanfordData, tests: { value: 'GMAT required', source_url: 'javascript:alert(1)' } }))!;
  assert.equal(p.tests?.source_url, null);
  assert.equal(requirementChecklist(p).find((i) => i.key === 'tests')?.source_url, 'https://www.gsb.stanford.edu/programs/mba', 'falls back to the program page');
});

test('englishSummary gives short chips', () => {
  assert.deepEqual(englishSummary(kellogg), ['IELTS 7.0', 'TOEFL 100', 'Duolingo 125']);
  assert.deepEqual(englishSummary(stanford), ['Duolingo not accepted']);
  assert.deepEqual(englishSummary({ english: null }), ['English test not stated']);
  assert.deepEqual(englishSummary({ english: { ielts_min: '6.5 overall, 6.0 each band', toefl_min: 'not stated', duolingo: 'not stated', pte_min: '68', other_tests: null, waiver: null, source_url: null } }), ['IELTS 6.5', 'Duolingo not stated', 'PTE 68']);
  assert.deepEqual(englishSummary({ english: { ielts_min: 'accepted, no minimum published', toefl_min: null, duolingo: 'accepted', pte_min: 'not accepted', other_tests: null, waiver: 'x', source_url: null } }), ['IELTS accepted', 'Duolingo accepted', 'PTE not accepted']);
  assert.deepEqual(englishSummary({ english: { ielts_min: null, toefl_min: null, duolingo: null, pte_min: null, other_tests: null, waiver: 'English-taught degree', source_url: null } }), ['Duolingo not stated']);
});

test('minimumScore reads real research wording without inventing a number', () => {
  const cases: [string, string | null][] = [
    ['accepted (min 135 overall, 125 each component)', '135'], ['accepted (no minimum to apply; discouraged below 145)', null],
    ['accepted (equivalent to TOEFL 100; no specific Duolingo number given)', null], ['accepted (DET listed; minimum not stated)', null],
    ['7.0 overall, 6.5 each band', '7.0'], ['100 iBT (min 20 Listening, 20 Speaking)', '100'], ['iBT 100 for tests before Jan 21, 2026', '100'],
    ['7.0 minimum overall (UCLA minimum)', '7.0'], ['No minimum to apply; Admissions Board discourages below 7.5', null], ['Set by Graduate School (not listed on page)', null],
  ];
  for (const [v, want] of cases) assert.equal(minimumScore(v), want, v);
  assert.deepEqual(englishSummary({ english: { ielts_min: 'No minimum to apply; Admissions Board discourages below 7.5', toefl_min: 'not stated on pages fetched', duolingo: 'accepted (no minimum to apply; discouraged below 145)', pte_min: '68 overall (Academic); online PTE not accepted', other_tests: null, waiver: null, source_url: null } }),
    ['IELTS accepted', 'Duolingo accepted', 'PTE 68']);
});
test('video and interview wording that means "none" is left off the checklist', () => {
  for (const v of ['Page does not mention a video requirement.', 'None stated.', 'Not mentioned on the applying page.', 'No video at application. Waitlisted candidates are invited later.']) {
    const p = parseProgram(row({ ...stanfordData, video_assessment: { value: v, source_url: null }, interview: { value: 'Not mentioned', source_url: null } }))!;
    const keys = requirementChecklist(p).map((i) => i.key);
    assert.ok(!keys.includes('video'), v); assert.ok(!keys.includes('interview'));
  }
  const p = parseProgram(row({ ...stanfordData, video_assessment: { value: 'Video interview sent by email after submission', source_url: null } }))!;
  assert.equal(requirementChecklist(p).find((i) => i.key === 'video')?.mandatory, true);
});

test('requirementChecklist is ordered and complete for a full program', () => {
  const items = requirementChecklist(stanford);
  assert.deepEqual(items.map((i) => i.key), ['deadline', 'tests', 'english', 'essay-1', 'essay-2', 'interview', 'recommendations', 'resume', 'transcripts', 'fee']);
  for (const i of items) { assert.ok(REQ_CATEGORIES.includes(i.category), i.category); assert.ok(i.source_url?.startsWith('https://'), i.key); assert.ok(i.detail.length > 0); }
  const e1 = items[3];
  assert.equal(e1.name, 'Essay 1: What matters most to you, and why?'); assert.match(e1.detail, /What matters most to you, and why\?\nLimit: up to 650 words/);
  assert.equal(e1.essay?.word_limit, 650); assert.equal(e1.source_url, `${GSB}/application/essays`);
  const tests = items[1]; assert.equal(tests.name, 'GMAT/GRE'); assert.equal(tests.mandatory, true, '"no minimum score" is not optional');
  const eng = items[2]; assert.match(eng.detail, /Duolingo: not accepted/); assert.match(eng.detail, /Waiver: Not required if a later graduate program/);
  assert.equal(items.find((i) => i.key === 'interview')?.mandatory, false, 'interviews are invite-only');
  assert.ok(!items.some((i) => i.key === 'video'), '"none required" video is left out');
  assert.match(items.find((i) => i.key === 'transcripts')!.detail, /Good to know: Upload unofficial transcripts/);
  assert.equal(items.find((i) => i.key === 'fee')?.detail, 'USD 275');
});
test('requirementChecklist is honest about missing sections', () => {
  const items = requirementChecklist(kellogg);
  assert.deepEqual(items.map((i) => i.key), ['deadline', 'tests', 'english', 'essay-1', 'video', 'recommendations', 'resume', 'transcripts', 'fee']);
  const video = items.find((i) => i.key === 'video')!; assert.equal(video.mandatory, true); assert.equal(video.group, 'interview');
  for (const k of ['recommendations', 'resume', 'fee', 'deadline']) assert.match(items.find((i) => i.key === k)!.detail, /could not find this/);
  assert.equal(items.find((i) => i.key === 'recommendations')?.mandatory, false);
  assert.equal(items.find((i) => i.key === 'resume')?.source_url, kellogg.program_url);
  const optional = parseProgram(row({ ...kelloggData, tests: { value: 'GMAT/GRE optional for this program', source_url: null }, essays: { items: [{ prompt: 'Anything else?', limit: '250 words', required: false }], source_url: null } }))!;
  const oi = requirementChecklist(optional);
  assert.equal(oi[0].key, 'deadline'); assert.equal(oi[0].mandatory, true); assert.equal(oi[1].mandatory, false); assert.equal(oi[3].mandatory, false); assert.match(oi[3].detail, /\(Optional\)/);
});
test('clearlyOptional only when nothing says required', () => {
  assert.ok(clearlyOptional('Test optional')); assert.ok(clearlyOptional('GMAT/GRE not required'));
  assert.ok(!clearlyOptional('GMAT or GRE required; AWA not required')); assert.ok(!clearlyOptional('No minimum test score required'));
  assert.ok(!clearlyOptional('GMAT or GRE accepted. Self-reported scores allowed.'));
});
test('groupChecklist follows the display order and drops empty groups', () => {
  const g = groupChecklist(requirementChecklist(stanford));
  assert.deepEqual(g.map((x) => x.label), ['Tests and English', 'Essays', 'Interview and video', 'Recommendations', 'Other', 'Deadlines and fee']);
  const noInterview = parseProgram(row({ ...kelloggData, video_assessment: null }))!;
  assert.ok(!groupChecklist(requirementChecklist(noInterview)).some((x) => x.group === 'interview'));
});

test('requirementRows add the form and submission items the app relies on, essays link by key', () => {
  const rows = requirementRows(stanford);
  const names = rows.map((r) => r.name);
  assert.equal(names[names.length - 1], 'Submission confirmation');
  assert.ok(names.indexOf('Application form') === names.indexOf('Application fee') - 1);
  for (const n of ['GMAT/GRE', 'English proficiency', 'Resume', 'Academic transcripts', 'Application fee']) assert.ok(names.includes(n), n);
  assert.deepEqual(rows.map((r) => r.sort_order), rows.map((_, i) => i + 1));
  assert.ok(rows.filter((r) => r.is_default).every((r) => ['Application form', 'Submission confirmation'].includes(r.name)));
  assert.match(rows.find((r) => r.key === 'essay-1')!.notes, /Source: https:\/\/www\.gsb\.stanford\.edu/);
  assert.equal(rows.find((r) => r.key === 'essay-1')!.essay_key, 'essay-1');
  const essays = essayRows(stanford);
  assert.deepEqual(essays.map((e) => [e.key, e.word_limit]), [['essay-1', 650], ['essay-2', 350]]);
  assert.equal(essays[1].title, 'Essay 2: Why Stanford for you?'); assert.match(essays[0].prompt, /^What matters most to you, and why\?\n\nLimit: up to 650 words$/);
});

test('small parsers', () => {
  assert.equal(essayTitle(3, 'Tell us about the pivotal experiences and decisions that brought you here.'), 'Essay 3: Tell us about the pivotal experiences and...');
  assert.equal(parseWordLimit('up to 1,000 words'), 1000); assert.equal(parseWordLimit('500-word essay'), 500); assert.equal(parseWordLimit('300 characters'), null);
  assert.equal(parseWordLimit('one page'), null); assert.equal(parseWordLimit(null), null);
  assert.equal(parseIntake('Fall 2027 (September)'), 'Fall 2027'); assert.equal(parseIntake('august 2027 entry'), 'August 2027'); assert.equal(parseIntake('January intake 2028'), 'January 2028');
  assert.equal(parseIntake('Rolling'), null); assert.equal(parseIntake(null), null);
  assert.deepEqual(parseFee('USD 275', CURRENCIES), { amount: 275, currency: 'USD' }); assert.deepEqual(parseFee('$250 (2026-27 cycle)', CURRENCIES), { amount: 250, currency: 'USD' });
  assert.deepEqual(parseFee('S$100', CURRENCIES), { amount: 100, currency: 'SGD' }); assert.deepEqual(parseFee('GBP 1,000 deposit', CURRENCIES), { amount: 1000, currency: 'GBP' });
  assert.equal(parseFee('$250 for Round 1 and Round 2, $200 for Round 3', CURRENCIES), null); assert.equal(parseFee('No fee published', CURRENCIES), null);
});
test('programsForTrack: grad sees grad degree types with the preferred one first, undergrad sees none without undergrad data', () => {
  const m = parseProgram(row({ ...stanfordData }, { id: 'm', program_name: 'MSx', degree_type: 'masters' }))!;
  const o = parseProgram(row({ ...stanfordData }, { id: 'o', program_name: 'Joint degree', degree_type: 'weird' }))!;
  assert.equal(o.degree_type, 'other');
  assert.deepEqual(programsForTrack([o, stanford, m], 'grad').map((p) => p.id), ['p1', 'm', 'o']);
  assert.deepEqual(programsForTrack([o, stanford, m], 'grad', 'masters').map((p) => p.id), ['m', 'p1', 'o']);
  assert.deepEqual(programsForTrack([o, stanford, m], 'undergrad'), []);
});

// Real research output, when the files exist: every program must parse and give a sourced checklist.
const dir = path.join(import.meta.dirname, '..', '..', 'research', 'programs');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^p\d+\.json$/.test(f)).sort() : [];
test(`research files parse into usable checklists (${files.length} file(s) found)`, { skip: files.length === 0 ? 'no research files yet' : false }, () => {
  let n = 0;
  for (const f of files) {
    let arr: unknown;
    try { arr = JSON.parse(readFileSync(path.join(dir, f), 'utf8')); } catch { continue; } // a file still being written is skipped
    if (!Array.isArray(arr)) continue;
    for (const raw of arr as Record<string, unknown>[]) {
      const p: Program | null = parseProgram({ id: `${f}-${n}`, school_name: String(raw.school ?? ''), program_name: String(raw.program_name ?? ''), degree_type: raw.degree_type as string, format: null, duration: null, intake: null, program_url: raw.program_url as string, data: raw, collected_on: '2026-11-16' });
      assert.ok(p, `${f}: ${String(raw.program_name)}`);
      const items = requirementChecklist(p);
      assert.ok(items.length >= 7, `${p.program_name} has ${items.length} items`);
      for (const i of items) assert.ok(REQ_CATEGORIES.includes(i.category));
      assert.equal(items.filter((i) => i.key.startsWith('essay-')).length, p.essays?.items.length ?? 0);
      assert.ok(englishSummary(p).some((c) => c.startsWith('Duolingo') || c === 'English test not stated' || c === 'No English test needed'));
      for (const c of englishChips(p)) assert.ok(c.text.length <= 70, c.text);
      n++;
    }
  }
  assert.ok(n > 0);
});

const profile = {
  class_label: 'Class of 2028', gmat_avg: null, gmat_median: 730, gmat_range: 'middle 80%: 690-770 (Classic)', gmat_focus_median: 675, gmat_focus_range: '10th-90th percentile: 615-715',
  gre_verbal_avg: 162, gre_quant_avg: '163', gre_range: 'V 158-168, Q 157-168 (middle 80%)', gpa_avg: 3.6, gpa_range: null, work_exp_avg_years: 5, work_exp_range: '1-15 years',
  class_size: 'n/a', international_pct: 37, women_pct: null, countries: null, pct_submitted_gre: null, source_url: 'https://x.edu/profile', source_name: 'Class profile',
};
test('class profile and employment parse defensively', () => {
  const cp = parseClassProfile(profile)!;
  assert.equal(cp.gre_quant_avg, 163); assert.equal(cp.class_size, null); assert.equal(cp.source_url, 'https://x.edu/profile');
  assert.equal(parseClassProfile({ class_label: 'x', source_url: 'https://x.edu' }), null, 'no numbers or ranges means nothing to show');
  assert.equal(parseClassProfile('nope'), null);
  const em = parseEmployment({ report_label: 'Class of 2025', employed_3_months_pct: 140, median_base_salary: 'USD 175,000', source_url: 'javascript:x' })!;
  assert.equal(em.employed_3_months_pct, null); assert.equal(em.median_base_salary, 'USD 175,000'); assert.equal(em.source_url, null);
  assert.equal(parseEmployment({ report_label: 'x' }), null);
  const p = parseProgram({ ...row(stanfordData), class_profile: profile, employment: null })!;
  assert.equal(p.class_profile?.gmat_median, 730); assert.equal(p.employment, null);
});
test('compareScores says below / within / above and never predicts', () => {
  assert.deepEqual(parseRange('middle 80%: 690-770 (Classic)', 200, 800), { low: 690, high: 770 });
  assert.deepEqual(parseRange('10th-90th percentile: 615-715', 205, 805), { low: 615, high: 715 }, 'skips the 10-90 percentile pair');
  assert.deepEqual(parseGreRange('V 158-168, Q 157-168', 'quant'), { low: 157, high: 168 }); assert.equal(parseGreRange('no data', 'verbal'), null);
  assert.equal(gmatEdition({ test_type: 'GMAT', exam_version: null, overall: 655, quant: null, verbal: null }), 'focus');
  assert.equal(gmatEdition({ test_type: 'GMAT', exam_version: 'Classic (10th Edition)', overall: 705, quant: null, verbal: null }), 'classic');
  const cp = parseClassProfile(profile)!;
  const out = compareScores(cp, [
    { test_type: 'GMAT', exam_version: 'Focus Edition', overall: 605, quant: null, verbal: null },
    { test_type: 'GMAT', exam_version: 'Focus Edition', overall: 655, quant: null, verbal: null },
    { test_type: 'GRE', exam_version: null, overall: null, quant: 170, verbal: 160 },
    { test_type: 'IELTS', exam_version: null, overall: 8, quant: null, verbal: null },
  ]);
  assert.deepEqual(out.map((c) => [c.test, c.score, c.position]), [['GMAT Focus', '655', 'within'], ['GRE Verbal', '160', 'within'], ['GRE Quant', '170', 'above']]);
  assert.match(out[0].text, /^Your GMAT Focus 655 is within the published range 10th-90th percentile: 615-715 \(Class of 2028\)\.$/);
  for (const c of out) assert.doesNotMatch(c.text, /chance|likely|admit|odds/i);
  const medianOnly = parseClassProfile({ gmat_median: 730, class_label: 'Class of 2027' })!;
  assert.match(compareScores(medianOnly, [{ test_type: 'GMAT', exam_version: 'Classic', overall: 700, quant: null, verbal: null }])[0].text, /below the published median of 730/);
  assert.deepEqual(compareScores(null, []), []);
});

import { isParaphrased, noStudentVisa, officialDomains, registrableDomain, thirdPartySite } from '../lib/programs.ts';
test('third-party sources are flagged, school pages are not', () => {
  assert.equal(registrableDomain('https://www.sbs.ox.ac.uk/x'), 'ox.ac.uk'); assert.equal(registrableDomain('https://mba.nus.edu.sg/a'), 'nus.edu.sg');
  assert.equal(registrableDomain('https://www.clearadmit.com/2026/x'), 'clearadmit.com'); assert.equal(registrableDomain('not a url'), null);
  const imd = parseProgram(row({ ...stanfordData, program_url: 'https://www.imd.org/mba/', tests: { value: 'GMAT required', source_url: 'https://www.imd.org/mba/apply/' } }, { program_url: 'https://www.imd.org/mba/' }))!;
  const off = officialDomains(imd);
  assert.equal(thirdPartySite('https://www.imd.org/mba/class-profile/', off), null, 'school on a .org domain');
  assert.equal(thirdPartySite('https://www.gsb.stanford.edu/x', off), null, '.edu is the school');
  assert.equal(thirdPartySite('https://poetsandquants.com/2026/x', off), 'poetsandquants.com');
  assert.equal(thirdPartySite('https://www.randomblog.io/x', off), 'randomblog.io');
  assert.equal(thirdPartySite(null, off), null);
});
test('paraphrase and student visa cautions', () => {
  assert.ok(isParaphrased('Prompt paraphrased from the webinar')); assert.ok(!isParaphrased('Tell us about yourself'));
  for (const t of ['This online program does not sponsor F-1 visas.', 'No student visa is issued for this part-time format.', 'F-1 visa not available for this program.', 'Not visa-eligible.', 'International students are ineligible for an F-1 visa in this format.', 'The school cannot issue an I-20 for this program.'])
    assert.ok(noStudentVisa(t), t);
  for (const t of ['Visa documents are requested after admission.', 'F-1 visa sponsored; I-20 issued after deposit.', null]) assert.ok(!noStudentVisa(t), String(t));
});
test('GRE ranges in the wording the research uses', () => {
  assert.deepEqual(parseGreRange('Verbal median 161 (middle 80% 155-167); Quant median 162 (middle 80% 155-169)', 'quant'), { low: 155, high: 169 });
  assert.deepEqual(parseGreRange('Verbal median 161 (middle 80% 155-167); Quant median 162 (middle 80% 155-169)', 'verbal'), { low: 155, high: 167 });
  assert.equal(parseGreRange('Quant middle 80%: 160-170 (verbal not reported)', 'verbal'), null);
  assert.deepEqual(parseGreRange('Quant middle 80%: 160-170 (verbal not reported)', 'quant'), { low: 160, high: 170 });
  assert.equal(parseGreRange('Median V 159, Q 160 (2023-24)', 'verbal'), null);
});

/* ------------------------------------------------------------------ usability fixes (Nov 2026) */
import {
  IDR_PER, IDR_PER_USD, formatIdr, nextOpenRound, noEnglishTestNeeded, overallScore, parseRounds, sanitizeText, toIdr, validOverall,
} from '../lib/programs.ts';

test('English chips use the overall score only, with range checks', () => {
  const lbs = { ielts_min: '7.0 overall, 6.5 each band', toefl_min: '100 iBT (min 20 Listening, 20 Speaking, 19 Reading, 24 Writing)', duolingo: 'accepted (min 135 overall, 125 each component)', pte_min: '76 overall, 70 each component', other_tests: null, waiver: null, source_url: null };
  assert.deepEqual(englishSummary({ english: lbs }), ['IELTS 7.0', 'TOEFL 100', 'Duolingo 135', 'PTE 76']);
  assert.deepEqual(overallScore('TOEFL', '5.0 on the new scale (on/post Jan 21, 2026); 104 iBT (pre Jan 21, 2026); 600 paper'), { kind: 'score', value: '104' });
  assert.deepEqual(overallScore('TOEFL', '5.0 on the new scale'), { kind: 'score', value: '5.0' });
  assert.deepEqual(overallScore('TOEFL', 'No minimum to apply; discouraged below 109 iBT'), { kind: 'none' });
  assert.deepEqual(overallScore('IELTS', '75 overall'), { kind: 'invalid' });
  assert.deepEqual(overallScore('Duolingo', 'min 20'), { kind: 'invalid' });
  assert.deepEqual(overallScore('IELTS', 'Overall 6.5 with no band below 6.0'), { kind: 'score', value: '6.5' }, 'band minimum ignored');
  assert.deepEqual(overallScore('IELTS', 'Set by the Graduate School'), { kind: 'none' });
  for (const [t, ok, bad] of [['IELTS', 7, 10], ['TOEFL', 100, 20], ['TOEFL', 5, 130], ['Duolingo', 120, 60], ['PTE', 65, 95]] as const) {
    assert.ok(validOverall(t, ok), `${t} ${ok}`); assert.ok(!validOverall(t, bad), `${t} ${bad}`);
  }
  // Out of range: the text is shown instead of a made-up chip.
  const chips = englishChips({ english: { ...lbs, ielts_min: '75 overall', toefl_min: null, duolingo: 'not stated', pte_min: null } });
  assert.equal(chips[0].text, 'IELTS: 75 overall'); assert.equal(chips[0].tone, 'neutral');
  assert.equal(chips[1].text, 'Duolingo not stated'); assert.equal(chips[1].tone, 'neutral');
  assert.equal(englishChips({ english: lbs })[1].tone, 'blue');
});

test('a school that takes no English test gets one friendly green chip', () => {
  const fuqua = { ielts_min: null, toefl_min: null, duolingo: 'not accepted', pte_min: null, other_tests: null, waiver: 'Fuqua does not accept ESL test scores such as TOEFL, IELTS, PTE or Duolingo; proficiency assessed in the interview.', source_url: null };
  assert.ok(noEnglishTestNeeded(fuqua));
  assert.deepEqual(englishChips({ english: fuqua }).map((c) => [c.text, c.tone]), [['No English test needed', 'green']]);
  const mit = { ielts_min: null, toefl_min: null, duolingo: 'not stated', pte_min: null, other_tests: null, waiver: "No English test required: 'MIT Sloan does not accept TOEFL or IELTS scores.'", source_url: null };
  assert.deepEqual(englishSummary({ english: mit }), ['No English test needed']);
  assert.ok(!noEnglishTestNeeded({ ...mit, ielts_min: '7.0' }), 'a published minimum means a test is used');
  assert.ok(!noEnglishTestNeeded({ ...mit, waiver: 'Waived for English-taught degrees' }));
});

test('sanitizeText removes research-process remarks and keeps the rest', () => {
  assert.equal(sanitizeText("Three deadlines a year, all 17:00 UK time. Calendar with exact round dates sits in the 'Application calendar' section and was not in the fetched page text. Applications for August 2027 intake open."),
    'Three deadlines a year, all 17:00 UK time. Applications for August 2027 intake open.');
  assert.equal(sanitizeText('Fall 2027 (entry term not stated on fetched pages)'), 'Fall 2027');
  assert.equal(sanitizeText('entry term not stated on fetched pages'), null);
  assert.equal(sanitizeText("Decision dates are in the school's Application calendar section, which was not present in the retrievable page text."), null);
  assert.equal(sanitizeText('GMAT or GRE required; page labels conflict on the score window. Scores valid 5 years.'), 'GMAT or GRE required. Scores valid 5 years.');
  assert.equal(sanitizeText('Search snippet says 600 words. Limit is 500 words.'), 'Limit is 500 words.');
  assert.equal(sanitizeText('Intake August 2027 (page body also says August 2026).'), 'Intake August 2027.');
  assert.equal(sanitizeText('Tell us about yourself.'), 'Tell us about yourself.');
  assert.equal(sanitizeText(null), null);
});

test('parsed programs never carry research notes into what students see', () => {
  const p = parseProgram(row({
    ...stanfordData, internal_notes: 'SECRET research note', notes: 'Essay 1 prompt is paraphrased from the page extraction; verify exact wording. Visa support available.',
    deadlines: { value: 'Round 1 Sep 9, 2026. Round 2 dates not present in the retrievable page text.', source_url: null },
  }))!;
  const shown = JSON.stringify(p);
  assert.doesNotMatch(shown, /SECRET|internal_notes|retrievable|fetched|extraction|snippet/i);
  assert.equal(p.notes, 'Visa support available.');
  assert.ok(p.paraphrased.notes && p.paraphrased.essays, 'caution flags still come from the raw notes');
  assert.doesNotMatch(requirementRows(p).map((r) => r.notes).join('\n'), /SECRET|retrievable/);
});

test('parseRounds reads dated rounds, closes past ones and finds the next open round', () => {
  const today = new Date(2026, 10, 23); // 23 Nov 2026, local time
  const fuqua = 'Early Action (binding): app Sep 2, 2026, final decision Oct 15, 2026. Round 1: Sep 30, 2026 (decision Dec 10). Round 2: Jan 5, 2027 (decision Mar 11). Round 3: Mar 25, 2027 (decision May 6).';
  const r = parseRounds(fuqua, today);
  assert.deepEqual(r.map((x) => [x.label, x.date, x.closed]), [['Early Action', '2026-09-02', true], ['Round 1', '2026-09-30', true], ['Round 2', '2027-01-05', false], ['Round 3', '2027-03-25', false]]);
  const next = nextOpenRound(r)!;
  assert.equal(next.label, 'Round 2'); assert.equal(next.daysLeft, 43);
  // Day-first dates, R-labels, and a date without a year
  assert.deepEqual(parseRounds('R1 15 Sep 2026; R2 03 Nov 2026; R3 19 Jan 2027', today).map((x) => [x.label, x.date]), [['Round 1', '2026-09-15'], ['Round 2', '2026-11-03'], ['Round 3', '2027-01-19']]);
  assert.equal(parseRounds('Round Two submit by Jan 5, 2027 12:00 PM ET; Round 3: Mar 1 (decision Apr 2)', today)[1].date, '2027-03-01');
  assert.deepEqual(parseRounds('Rolling (International) May 13, 2027', today).map((x) => x.label), ['Rolling']);
  // Two intakes keep their rounds apart
  const insead = parseRounds('Aug 2027 intake: R1 15 Sep 2026; R2 03 Nov 2026. Jan 2028 intake: R1 23 Mar 2027', today);
  assert.equal(insead[2].label, 'Round 1 (Jan 2028 intake)');
  // No labels: one deadline per part; no dates at all: nothing
  assert.deepEqual(parseRounds('26 Jan 2027 (5 Feb / 12-13 Feb); 16 Mar 2027 (2 Apr)', today).map((x) => x.label), ['Deadline 1', 'Deadline 2']);
  assert.deepEqual(parseRounds('Three application deadlines a year, all 17:00 UK time.', today), []);
  assert.equal(parseRounds('Round 1 Sep 9, 2026', today)[0].closed, true);
  assert.equal(nextOpenRound(parseRounds('Round 1 Sep 9, 2026', today)), null);
  assert.equal(parseRounds('Round 1 Nov 23, 2026', today)[0].closed, false, 'the deadline day itself is still open');
});

test('cost, scholarships and LPDP parse defensively; IDR is approximate at fixed rates', () => {
  const p = parseProgram(row({
    ...stanfordData,
    cost: { tuition: { amount: '82,000', currency: 'usd', basis: 'per year', year: '2026-27', source_url: 'https://x.edu/cost' }, living: { amount: -1, currency: 'USD' }, notes: null },
    fee_waiver: { value: 'Waived for Forte events', source_url: 'javascript:alert(1)' },
    scholarships: [{ name: 'Merit award', amount: 'up to full tuition', eligibility: 'All admits', international_ok: true, source_url: 'https://x.edu/s' }, { amount: 'no name' }, 'bad'],
    lpdp: { on_list: true, list_name: 'LPDP 2026 list' },
  }))!;
  assert.deepEqual(p.cost?.tuition, { amount: 82000, currency: 'USD', basis: 'per year', year: '2026-27', source_url: 'https://x.edu/cost' });
  assert.equal(p.cost?.living, null);
  assert.equal(p.fee_waiver?.source_url, null);
  assert.equal(p.scholarships.length, 1); assert.equal(p.scholarships[0].international_ok, true);
  assert.equal(p.lpdp?.on_list, true);
  const none = parseProgram(row({ ...stanfordData, lpdp: { on_list: null }, cost: 'lots', scholarships: null }))!;
  assert.equal(none.lpdp, null); assert.equal(none.cost, null); assert.deepEqual(none.scholarships, []);
  assert.equal(toIdr(100, 'USD'), 100 * IDR_PER_USD); assert.equal(toIdr(1, 'XYZ'), null);
  for (const c of ['USD', 'GBP', 'EUR', 'AUD', 'CAD', 'SGD', 'HKD', 'CHF']) assert.ok(IDR_PER[c] > 0, c);
  assert.equal(formatIdr(1_353_000_000), 'Rp 1.4 billion'); assert.equal(formatIdr(450_000_000), 'Rp 450 million'); assert.equal(formatIdr(75000), 'Rp 75,000');
});

test('undergrad programs: own track, no GMAT wording', () => {
  const ug = parseProgram(row({ ...stanfordData, tests: null, application_system: 'Common App', aid_policy: { value: 'Need-blind for all', source_url: null } }, { id: 'u', program_name: 'BSc Computer Science', degree_type: 'undergraduate' }))!;
  const mba = parseProgram(row({ ...stanfordData }))!;
  assert.equal(ug.degree_type, 'undergrad'); assert.equal(ug.application_system, 'Common App'); assert.equal(ug.aid_policy?.value, 'Need-blind for all');
  assert.deepEqual(programsForTrack([ug, mba], 'undergrad').map((p) => p.id), ['u']);
  assert.deepEqual(programsForTrack([ug, mba], 'grad').map((p) => p.id), ['p1']);
  const names = requirementChecklist(ug).map((i) => i.name).join(' | ');
  assert.doesNotMatch(names, /GMAT|GRE|Resume|round/i);
  assert.match(names, /rapor/);
});
