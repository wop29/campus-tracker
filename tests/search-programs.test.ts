import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchAll, programSubjects, MAX_PROGRAM_HITS, type SearchProgram } from '../lib/search.ts';

const schools = [{ id: 's1', name: 'Chicago Booth', short_name: 'Booth', country: 'United States', location: 'Chicago', tier: null, in_portfolio: true, notes: null }];
const programs: SearchProgram[] = [
  { id: 'p1', school_name: 'Chicago Booth', program_name: 'Master in Finance', degree_type: 'masters' },
  { id: 'p2', school_name: 'Stanford GSB', program_name: 'MS Computer Science/MBA (CS Department + GSB)', degree_type: 'mba' },
  { id: 'p3', school_name: 'University of Melbourne', program_name: 'Bachelor of Science', degree_type: 'undergrad', subjects: ['Computer Science', 'Data Science'] },
  { id: 'p4', school_name: 'Chicago Booth', program_name: 'Full-Time MBA', degree_type: 'mba', concentrations: 'Finance; Accounting' },
];
const base = { schools, applications: [], essays: [] };

test('search: programs by name and subject, grouped and linked to the student school', () => {
  const cs = searchAll('computer science', { ...base, programs });
  assert.deepEqual(cs.programs.map((p) => p.id).sort(), ['p2', 'p3']); assert.equal(cs.schools.length, 0);
  const fin = searchAll('finance', { ...base, programs });
  assert.deepEqual(fin.programs.map((p) => p.id).sort(), ['p1', 'p4']); assert.ok(fin.programs.every((p) => p.schoolId === 's1'));
  assert.equal(searchAll('computer science', { ...base, programs }).programs.find((p) => p.id === 'p3')?.schoolId, null);
  assert.equal(searchAll('bachelor', { ...base, programs }).programs[0].degreeLabel, "Bachelor's");
  assert.equal(searchAll('booth', { ...base, programs }).programs.length, 2); // school name also matches programs
});
test('search: programs optional (old callers) and empty query', () => {
  const r = searchAll('finance', base); assert.deepEqual(r.programs, []); assert.equal(r.programsTotal, 0);
  assert.equal(searchAll(' ', { ...base, programs }).programs.length, 0);
});
test('search: program hits are capped but counted', () => {
  const many = Array.from({ length: MAX_PROGRAM_HITS + 5 }, (_, i) => ({ id: `x${i}`, school_name: `School ${i}`, program_name: 'Master of Finance', degree_type: 'masters' }));
  const r = searchAll('finance', { ...base, programs: many }); assert.equal(r.programs.length, MAX_PROGRAM_HITS); assert.equal(r.programsTotal, MAX_PROGRAM_HITS + 5);
});
test('programSubjects reads every optional key defensively', () => {
  assert.deepEqual(programSubjects({ id: 'a', school_name: 'X', program_name: 'Y', degree_type: null, subjects: ['CS', 'cs', 5, null], field: 'Maths, Physics', majors: { bad: true } }), ['CS', 'Maths', 'Physics']);
  assert.deepEqual(programSubjects({ id: 'a', school_name: 'X', program_name: 'Y', degree_type: null }), []);
});
