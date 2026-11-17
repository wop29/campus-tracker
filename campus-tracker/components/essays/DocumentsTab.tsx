'use client';
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Eye, Pencil, Trash2, Upload } from 'lucide-react';
import { Badge, Button, EmptyState, ErrorBox, Field, Input, Loading, Modal, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must, useQuery } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { fieldErrors } from '@/lib/essays';
import { ACCEPT_ATTR, DOC_CATEGORIES, DOC_CATEGORY_LABEL, documentMetaSchema, fmtBytes, previewKind, stripExt, validateFile, type DocumentRow, type DocumentVersionRow } from '@/lib/documents';
import { appLabel, errMsg, useSchoolsApps, type AppLite, type SchoolLite } from './data';
import { addDocumentVersion, createDocumentWithFile, signedUrl } from './doc-actions';

export function DocumentsTab() {
  const toast = useToast();
  const { schools, apps } = useSchoolsApps();
  const docs = useQuery<DocumentRow[]>((sb) => sb.from('documents').select('*').is('deleted_at', null).order('updated_at', { ascending: false }), []);
  const vers = useQuery<DocumentVersionRow[]>((sb) => sb.from('document_versions').select('*').order('version_number', { ascending: false }), []);
  const [f, setF] = useState({ q: '', category: '', school: '' });
  const [upload, setUpload] = useState(false);
  const [edit, setEdit] = useState<DocumentRow | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ title: string; url: string; kind: 'pdf' | 'image' } | null>(null);
  const [newVerFor, setNewVerFor] = useState<DocumentRow | null>(null);
  const reload = () => { void docs.reload(); void vers.reload(); };

  const byDoc = useMemo(() => { const m = new Map<string, DocumentVersionRow[]>(); for (const v of vers.data ?? []) m.set(v.document_id, [...(m.get(v.document_id) ?? []), v]); return m; }, [vers.data]);
  const rows = (docs.data ?? []).filter((d) => (!f.category || d.category === f.category) && (!f.school || d.school_id === f.school) && (!f.q || d.name.toLowerCase().includes(f.q.toLowerCase())));

  async function openPreview(v: DocumentVersionRow, title: string) {
    const kind = previewKind(v.file_name);
    if (kind === 'none') { toast('Preview is available for PDF and images. Use Download for other files.', 'err'); return; }
    try { setPreview({ title: `${title} (v${v.version_number})`, url: await signedUrl(supabaseBrowser(), v.storage_path), kind }); } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function download(v: DocumentVersionRow) {
    try { const url = await signedUrl(supabaseBrowser(), v.storage_path, { download: v.file_name }); const a = document.createElement('a'); a.href = url; a.download = v.file_name; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { toast(errMsg(e), 'err'); }
  }
  async function remove(d: DocumentRow) {
    try { await must(supabaseBrowser().from('documents').update({ deleted_at: new Date().toISOString() }).eq('id', d.id)); toast('Document deleted. Stored files are kept.'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
  }
  const sName = (id: string | null) => schools.find((s) => s.id === id)?.short_name || schools.find((s) => s.id === id)?.name;
  const aText = (id: string | null) => { const a = apps.find((x) => x.id === id); return a ? appLabel(a) : null; };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Input className="max-w-[220px]" placeholder="Search documents" aria-label="Search documents" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select className="max-w-[210px]" aria-label="Filter by category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">All categories</option>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</Select>
        <Select className="max-w-[200px]" aria-label="Filter by school" value={f.school} onChange={(e) => setF({ ...f, school: e.target.value })}><option value="">All schools</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Button className="ml-auto" onClick={() => setUpload(true)}><Upload size={14} /> Upload document</Button>
      </div>
      {docs.loading || vers.loading ? <Loading /> : docs.error ? <ErrorBox message={docs.error} onRetry={reload} /> : vers.error ? <ErrorBox message={vers.error} onRetry={reload} /> : !docs.data?.length ? (
        <EmptyState title="No documents yet" hint="Upload PDF, DOCX, XLSX, PPTX, JPG or PNG files up to 25 MB. Each upload is stored privately and versioned." action={<Button onClick={() => setUpload(true)}>Upload a document</Button>} />
      ) : !rows.length ? <EmptyState title="No documents match these filters" /> : (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b bg-bg text-left text-xs text-secondary"><tr><th className="w-8 p-2" /><th className="p-2">Name</th><th className="p-2">Category</th><th className="p-2">Linked to</th><th className="p-2">Current file</th><th className="p-2">Updated</th><th className="p-2 text-right">Actions</th></tr></thead>
            <tbody>{rows.map((d) => {
              const vs = byDoc.get(d.id) ?? []; const cur = vs.find((v) => v.version_number === d.current_version) ?? vs[0]; const isOpen = open.has(d.id);
              return (<FragmentRow key={d.id}>
                <tr className="border-b">
                  <td className="p-2"><button aria-label={isOpen ? 'Hide versions' : 'Show versions'} aria-expanded={isOpen} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(d.id)) n.delete(d.id); else n.add(d.id); return n; })}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button></td>
                  <td className="p-2 font-medium">{d.name}</td><td className="p-2"><Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge></td>
                  <td className="p-2 text-xs">{[sName(d.school_id), aText(d.application_id)].filter(Boolean).join(' / ') || '-'}</td>
                  <td className="p-2 text-xs">{cur ? <>v{cur.version_number}: {cur.file_name}<br /><span className="text-secondary">{fmtBytes(cur.size_bytes)}</span></> : 'No file'}</td>
                  <td className="p-2 text-xs">{fmtDate(d.updated_at)}</td>
                  <td className="p-2"><div className="flex flex-wrap justify-end gap-1">
                    {cur && previewKind(cur.file_name) !== 'none' && <Button size="sm" variant="secondary" onClick={() => void openPreview(cur, d.name)}><Eye size={12} /> Preview</Button>}
                    {cur && <Button size="sm" variant="secondary" onClick={() => void download(cur)}><Download size={12} /> Download</Button>}
                    <Button size="sm" variant="secondary" onClick={() => setNewVerFor(d)}><Upload size={12} /> New version</Button>
                    <Button size="sm" variant="ghost" aria-label={`Edit ${d.name}`} onClick={() => setEdit(d)}><Pencil size={12} /></Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${d.name}`} onClick={() => { if (window.confirm(`Delete "${d.name}"? It is hidden; the stored files are kept.`)) void remove(d); }}><Trash2 size={12} /></Button>
                  </div></td>
                </tr>
                {isOpen && <tr className="border-b bg-bg/50"><td /><td colSpan={6} className="p-2"><ul className="space-y-1 text-xs">{vs.length === 0 ? <li>No versions.</li> : vs.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-2"><span className="font-medium">v{v.version_number}</span>{v.version_number === d.current_version && <Badge tone="success">Current</Badge>}<span>{v.file_name}</span><span className="text-secondary">{fmtBytes(v.size_bytes)} - {fmtDate(v.created_at)}</span>
                    {previewKind(v.file_name) !== 'none' && <Button size="sm" variant="ghost" onClick={() => void openPreview(v, d.name)}>Preview</Button>}<Button size="sm" variant="ghost" onClick={() => void download(v)}>Download</Button></li>))}</ul></td></tr>}
              </FragmentRow>);
            })}</tbody>
          </table>
        </div>
      )}
      {upload && <UploadModal schools={schools} apps={apps} onClose={() => setUpload(false)} onDone={() => { setUpload(false); reload(); }} />}
      {newVerFor && <NewVersionModal doc={newVerFor} onClose={() => setNewVerFor(null)} onDone={() => { setNewVerFor(null); reload(); }} />}
      {edit && <EditDocModal doc={edit} schools={schools} apps={apps} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title ?? ''} wide>
        {preview?.kind === 'pdf' && <iframe src={preview.url} title={preview.title} className="h-[70vh] w-full rounded border" />}
        {preview?.kind === 'image' && /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview.url} alt={preview.title} className="mx-auto max-h-[70vh] rounded border" />}
        <p className="mt-2 text-xs text-secondary">This link is temporary and private to you.</p>
      </Modal>
    </div>
  );
}
function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function FilePicker({ file, setFile, error, setError }: { file: File | null; setFile: (f: File | null) => void; error: string | null; setError: (e: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Field label="File" error={error} hint="PDF, DOCX, XLSX, PPTX, JPG or PNG, up to 25 MB">
      <input ref={ref} type="file" accept={ACCEPT_ATTR} className="block w-full text-sm" onChange={(e) => {
        const f = e.target.files?.[0] ?? null;
        if (!f) { setFile(null); setError(null); return; }
        const c = validateFile(f);
        if (!c.ok) { setError(c.error); setFile(null); if (ref.current) ref.current.value = ''; return; }
        setError(null); setFile(f);
      }} />
      {file && <span className="block text-xs text-secondary">{file.name} ({fmtBytes(file.size)})</span>}
    </Field>
  );
}

function UploadModal({ schools, apps, onClose, onDone }: { schools: SchoolLite[]; apps: AppLite[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null); const [fileErr, setFileErr] = useState<string | null>(null);
  const [v, setV] = useState({ name: '', category: 'other', school_id: '', application_id: '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    if (!file) { setFileErr('Choose a file to upload'); return; }
    const parsed = documentMetaSchema.safeParse({ ...v, name: v.name || stripExt(file.name) });
    if (!parsed.success) { setErrors(fieldErrors(parsed.error)); return; }
    setErrors({}); setBusy(true);
    try { await createDocumentWithFile(supabaseBrowser(), file, { name: parsed.data.name, category: parsed.data.category, school_id: parsed.data.school_id, application_id: parsed.data.application_id }); toast('Document uploaded'); onDone(); }
    catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={busy ? () => {} : onClose} title="Upload document">
      <form onSubmit={submit} className="space-y-3" noValidate>
        <FilePicker file={file} setFile={setFile} error={fileErr} setError={setFileErr} />
        <Field label="Name" error={errors.name} hint="Defaults to the file name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={file ? stripExt(file.name) : ''} /></Field>
        <MetaFields v={v} setV={setV} errors={errors} schools={schools} apps={apps} />
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Uploading...' : 'Upload'}</Button></div>
      </form>
    </Modal>
  );
}
function MetaFields({ v, setV, errors, schools, apps }: { v: { category: string; school_id: string; application_id: string }; setV: (x: never) => void; errors: Record<string, string>; schools: SchoolLite[]; apps: AppLite[] }) {
  const set = setV as unknown as (fn: (s: typeof v) => typeof v) => void;
  return (<>
    <Field label="Category" error={errors.category}><Select value={v.category} onChange={(e) => set((s) => ({ ...s, category: e.target.value }))}>{DOC_CATEGORIES.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</Select></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="School (optional)"><Select value={v.school_id} onChange={(e) => set((s) => ({ ...s, school_id: e.target.value, application_id: apps.find((a) => a.id === s.application_id)?.school_id === e.target.value ? s.application_id : '' }))}><option value="">None</option>{schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Application (optional)"><Select value={v.application_id} onChange={(e) => { const a = apps.find((x) => x.id === e.target.value); set((s) => ({ ...s, application_id: e.target.value, school_id: a ? a.school_id : s.school_id })); }}><option value="">None</option>{apps.filter((a) => !v.school_id || a.school_id === v.school_id).map((a) => <option key={a.id} value={a.id}>{appLabel(a)}</option>)}</Select></Field>
    </div></>);
}
function NewVersionModal({ doc, onClose, onDone }: { doc: DocumentRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; if (!file) { setErr('Choose a file to upload'); return; }
    setBusy(true);
    try { const n = await addDocumentVersion(supabaseBrowser(), doc.id, file); toast(`Version ${n} uploaded. Earlier versions are kept.`); onDone(); } catch (e2) { toast(errMsg(e2), 'err'); } finally { setBusy(false); }
  }
  return (<Modal open onClose={busy ? () => {} : onClose} title={`New version of "${doc.name}"`}><form onSubmit={submit} className="space-y-3"><FilePicker file={file} setFile={setFile} error={err} setError={setErr} /><p className="text-xs text-secondary">The previous file stays available in the version list.</p>
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Uploading...' : 'Upload version'}</Button></div></form></Modal>);
}
function EditDocModal({ doc, schools, apps, onClose, onDone }: { doc: DocumentRow; schools: SchoolLite[]; apps: AppLite[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast(); const [v, setV] = useState({ name: doc.name, category: doc.category as string, school_id: doc.school_id ?? '', application_id: doc.application_id ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return;
    const p = documentMetaSchema.safeParse(v); if (!p.success) { setErrors(fieldErrors(p.error)); return; }
    setErrors({}); setBusy(true);
    try { await must(supabaseBrowser().from('documents').update({ name: p.data.name, category: p.data.category, school_id: p.data.school_id ?? null, application_id: p.data.application_id ?? null }).eq('id', doc.id)); toast('Document updated'); onDone(); }
    catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  }
  return (<Modal open onClose={onClose} title="Edit document"><form onSubmit={submit} className="space-y-3" noValidate>
    <Field label="Name" error={errors.name}><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
    <MetaFields v={v} setV={setV as never} errors={errors} schools={schools} apps={apps} />
    <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</Button></div></form></Modal>);
}
