'use client';
// Storage + DB operations for documents. Upload first; roll back the file if any row insert fails; never create rows if the upload fails.
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildStoragePath, validateFile, type DocCategory } from '@/lib/documents';

const BUCKET = 'documents';
async function currentUserId(sb: SupabaseClient) {
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new Error('You are signed out. Sign in again to upload.');
  return data.user.id;
}
async function removeFile(sb: SupabaseClient, path: string) { await sb.storage.from(BUCKET).remove([path]).catch(() => {}); }
async function uploadFile(sb: SupabaseClient, path: string, file: File, mime: string) {
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

export async function createDocumentWithFile(sb: SupabaseClient, file: File, meta: { name: string; category: DocCategory; school_id?: string; application_id?: string }) {
  const check = validateFile(file); if (!check.ok) throw new Error(check.error);
  const userId = await currentUserId(sb);
  const id = crypto.randomUUID();
  const path = buildStoragePath(userId, id, 1, file.name);
  await uploadFile(sb, path, file, check.mime);
  const doc = await sb.from('documents').insert({ id, name: meta.name, category: meta.category, school_id: meta.school_id ?? null, application_id: meta.application_id ?? null, current_version: 1 });
  if (doc.error) { await removeFile(sb, path); throw new Error(`Could not save the document record: ${doc.error.message}. The uploaded file was removed.`); }
  const ver = await sb.from('document_versions').insert({ document_id: id, version_number: 1, storage_path: path, file_name: file.name, mime_type: check.mime, size_bytes: file.size });
  if (ver.error) {
    await sb.from('documents').delete().eq('id', id);
    await removeFile(sb, path);
    throw new Error(`Could not save the version record: ${ver.error.message}. The uploaded file was removed.`);
  }
  return id;
}

/** Adds a new version. Existing versions and their files are never touched. */
export async function addDocumentVersion(sb: SupabaseClient, documentId: string, file: File) {
  const check = validateFile(file); if (!check.ok) throw new Error(check.error);
  const userId = await currentUserId(sb);
  const latest = await sb.from('document_versions').select('version_number').eq('document_id', documentId).order('version_number', { ascending: false }).limit(1);
  if (latest.error) throw new Error(latest.error.message);
  const next = (latest.data?.[0]?.version_number ?? 0) + 1;
  const path = buildStoragePath(userId, documentId, next, file.name);
  await uploadFile(sb, path, file, check.mime);
  const ver = await sb.from('document_versions').insert({ document_id: documentId, version_number: next, storage_path: path, file_name: file.name, mime_type: check.mime, size_bytes: file.size });
  if (ver.error) { await removeFile(sb, path); throw new Error(`Could not save the version record: ${ver.error.message}. The uploaded file was removed.`); }
  const upd = await sb.from('documents').update({ current_version: next }).eq('id', documentId);
  if (upd.error) throw new Error(`Version ${next} was saved but the document could not be updated to point to it: ${upd.error.message}`);
  return next;
}

export async function signedUrl(sb: SupabaseClient, path: string, opts?: { download?: string; seconds?: number }) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, opts?.seconds ?? 120, opts?.download ? { download: opts.download } : undefined);
  if (error || !data) throw new Error(error?.message ?? 'Could not create a download link');
  return data.signedUrl;
}
