import type { SupabaseClient } from '@supabase/supabase-js';

/** Every table that holds the user's own data. Soft-deleted rows are included so a backup is complete. */
export const BACKUP_TABLES = [
  'applicant_profiles', 'education_records', 'test_scores', 'work_experiences', 'leadership_experiences', 'achievements', 'career_goals',
  'schools', 'school_programs', 'school_sources', 'school_admissions_data', 'saved_comparisons',
  'applications', 'application_requirements', 'application_tasks', 'deadlines', 'documents', 'document_versions',
  'essays', 'essay_versions', 'story_bank', 'essay_stories', 'recommenders', 'recommendations',
  'interview_sessions', 'interview_questions', 'interview_feedback', 'scholarships', 'scholarship_applications',
  'expenses', 'financial_projections', 'admissions_decisions', 'ai_assessments', 'ai_recommendations', 'ai_conversations', 'notifications', 'activity_logs',
] as const;

/** Marker values written into every backup file; the importer refuses files without them. */
export const BACKUP_APP = 'mba-admissions-os';
export const BACKUP_FORMAT_VERSION = 1;

const PAGE = 1000;
/** Stable paging order per table (essay_stories has no id or created_at). */
const ORDER: Record<string, string[]> = { essay_stories: ['essay_id', 'story_id'] };
/** Reads every row of every table (paged past the 1000-row API limit). Throws, naming the table, if any read fails so a partial backup is never presented as complete. */
export async function buildBackup(sb: SupabaseClient, onProgress?: (done: number, total: number) => void) {
  const tables: Record<string, unknown[]> = {};
  let i = 0;
  for (const t of BACKUP_TABLES) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      let q = sb.from(t).select('*');
      for (const col of ORDER[t] ?? ['created_at', 'id']) q = q.order(col, { ascending: true });
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw new Error(`Could not read ${t}: ${error.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    tables[t] = rows;
    onProgress?.(++i, BACKUP_TABLES.length);
  }
  return {
    app: BACKUP_APP, format_version: BACKUP_FORMAT_VERSION, exported_at: new Date().toISOString(),
    note: 'Row data only. Uploaded files in storage are not included; document_versions lists their storage paths.',
    row_counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])), tables,
  };
}
