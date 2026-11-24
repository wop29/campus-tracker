// Pure document helpers: file validation, name sanitising, storage paths.
import { z } from 'zod';

export const DOC_CATEGORIES = ['resume', 'transcripts', 'test_scores', 'essays', 'recommendation_materials', 'certificates', 'financial_records', 'other'] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];
export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  resume: 'Resume', transcripts: 'Transcripts', test_scores: 'Test scores', essays: 'Essays', recommendation_materials: 'Recommendation materials',
  certificates: 'Certificates', financial_records: 'Financial records', other: 'Other',
};
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const ALLOWED_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
};
export const ACCEPT_ATTR = Object.keys(ALLOWED_TYPES).map((e) => '.' + e).join(',');
export const fileExt = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

export type FileCheck = { ok: true; mime: string } | { ok: false; error: string };
export function validateFile(f: { name: string; size: number; type?: string }): FileCheck {
  const ext = fileExt(f.name);
  const mime = ALLOWED_TYPES[ext];
  if (!mime) return { ok: false, error: `"${f.name}" is not an allowed file type. Use PDF, DOCX, XLSX, PPTX, JPG or PNG.` };
  if (f.type && f.type !== mime && !(ext === 'jpg' && f.type === 'image/jpeg')) {
    // Browsers sometimes report an empty or generic type; only reject when the reported type is a known different allowed type.
    if (Object.values(ALLOWED_TYPES).includes(f.type)) return { ok: false, error: `"${f.name}" has a ".${ext}" extension but its contents look like a different file type.` };
  }
  if (f.size <= 0) return { ok: false, error: `"${f.name}" is empty.` };
  if (f.size > MAX_FILE_BYTES) return { ok: false, error: `"${f.name}" is ${(f.size / 1048576).toFixed(1)} MB. The limit is 25 MB.` };
  return { ok: true, mime };
}

/** Safe storage file name: ASCII letters, digits, dot, dash, underscore only; extension kept; length capped. */
export function sanitizeFileName(name: string): string {
  const ext = fileExt(name);
  const base = (ext ? name.slice(0, name.length - ext.length - 1) : name).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._-]+|[._-]+$/g, '').replace(/_+/g, '_').slice(0, 80);
  const safeExt = ext.replace(/[^a-z0-9]/g, '');
  return `${base || 'file'}${safeExt ? '.' + safeExt : ''}`;
}
export const buildStoragePath = (userId: string, documentId: string, version: number, fileName: string) => `${userId}/${documentId}/v${version}-${sanitizeFileName(fileName)}`;
export const previewKind = (fileName: string): 'pdf' | 'image' | 'none' => { const e = fileExt(fileName); return e === 'pdf' ? 'pdf' : ['jpg', 'jpeg', 'png'].includes(e) ? 'image' : 'none'; };
export const fmtBytes = (n?: number | null) => (n == null ? '-' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const stripExt = (n: string) => (fileExt(n) ? n.slice(0, n.length - fileExt(n).length - 1) : n);

export type DocumentRow = { id: string; name: string; category: DocCategory; school_id: string | null; application_id: string | null; current_version: number; created_at: string; updated_at: string; deleted_at: string | null };
export type DocumentVersionRow = { id: string; document_id: string; version_number: number; storage_path: string; file_name: string; mime_type: string | null; size_bytes: number | null; created_at: string };

const opt = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().uuid().optional());
export const documentMetaSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Keep the name under 200 characters'),
  category: z.enum(DOC_CATEGORIES, { error: 'Choose a category' }),
  school_id: opt, application_id: opt,
});
