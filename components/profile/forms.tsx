'use client';
import { useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { Plus } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, EmptyState, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { verifyKey, type SectionKey } from '@/lib/profile';
import { currentUserId } from './data';

export type Vals = Record<string, string>;
export interface FDef {
  name: string; label: string; type: 'text' | 'email' | 'textarea' | 'date' | 'number' | 'select' | 'list'; options?: { value: string; label: string }[];
  hint?: string; resets?: string[]; wide?: boolean; required?: boolean; showWhen?: (v: Vals) => boolean; step?: string; placeholder?: string;
}
export interface Verification { map: Record<string, boolean>; toggle: (key: string, on: boolean) => Promise<void> }

const str = (v: unknown) => (v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v));
export const rowToVals = (fields: FDef[], row: Record<string, unknown> | null): Vals => Object.fromEntries(fields.map((f) => [f.name, row ? str(row[f.name]) : '']));

/** Converts form strings into a typed payload. Hidden fields become null. */
export function toPayload(fields: FDef[], vals: Vals): { payload: Record<string, unknown>; errors: Record<string, string> } {
  const payload: Record<string, unknown> = {}; const errors: Record<string, string> = {};
  const visible = (f: FDef) => !f.showWhen || f.showWhen(vals);
  for (const f of fields.filter(visible)) {
    const v = (vals[f.name] ?? '').trim();
    if (f.type === 'number') { if (!v) payload[f.name] = null; else { const n = Number(v); if (Number.isNaN(n)) errors[f.name] = 'Enter a number'; payload[f.name] = n; } }
    else if (f.type === 'list') payload[f.name] = v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
    else payload[f.name] = f.required ? v : v || null;
  }
  for (const f of fields.filter((x) => !visible(x))) if (!(f.name in payload)) payload[f.name] = f.type === 'list' ? [] : null;
  return { payload, errors };
}
export function zodErrors(res: z.ZodSafeParseResult<unknown>): Record<string, string> {
  const out: Record<string, string> = {}; if (!res.success) for (const i of res.error.issues) { const k = String(i.path[0] ?? '_'); out[k] ??= i.message; } return out;
}

export function VerifyToggle({ k, ver }: { k: string; ver: Verification }) {
  const [busy, setBusy] = useState(false); const toast = useToast();
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-secondary">
      <input type="checkbox" disabled={busy} checked={!!ver.map[k]} onChange={async (e) => { setBusy(true); try { await ver.toggle(k, e.target.checked); } catch (er) { toast((er as Error).message, 'err'); } finally { setBusy(false); } }} />
      Needs verification
    </label>
  );
}

function Control({ f, vals, set, err }: { f: FDef; vals: Vals; set: (k: string, v: string) => void; err?: string }) {
  const v = vals[f.name] ?? ''; const common = { value: v, onChange: (e: { target: { value: string } }) => set(f.name, e.target.value), 'aria-invalid': !!err };
  return (
    <Field label={f.label + (f.required ? ' *' : '')} hint={f.hint} error={err} className={f.wide || f.type === 'textarea' || f.type === 'list' ? 'sm:col-span-2' : ''}>
      {f.type === 'textarea' || f.type === 'list' ? <Textarea {...common} placeholder={f.placeholder} />
        : f.type === 'select' ? <Select {...common}><option value="">Select...</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
        : <Input {...common} type={f.type === 'number' ? 'number' : f.type} step={f.type === 'number' ? (f.step ?? 'any') : undefined} placeholder={f.placeholder} />}
    </Field>
  );
}

/** Add / edit / soft-delete list for one table with a modal form, zod validation and double-submit guard. */
export function RecordCrud<T extends { id: string }>(p: {
  table: string; section: SectionKey; title: string; noun: string; rows: T[]; fields: FDef[]; schema: z.ZodType; ver: Verification; reload: () => Promise<void>;
  summary: (r: T) => ReactNode; extraValidate?: (payload: Record<string, unknown>) => Record<string, string>; initial?: Vals; intro?: ReactNode; emptyHint: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false); const [editing, setEditing] = useState<T | null>(null);
  const [vals, setVals] = useState<Vals>({}); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const openNew = () => { setEditing(null); setVals({ ...rowToVals(p.fields, null), ...p.initial }); setErrors({}); setOpen(true); };
  const openEdit = (r: T) => { setEditing(r); setVals(rowToVals(p.fields, r as unknown as Record<string, unknown>)); setErrors({}); setOpen(true); };
  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v, ...Object.fromEntries((p.fields.find((f) => f.name === k)?.resets ?? []).map((r) => [r, ''])) }));

  async function save() {
    if (saving) return;
    const { payload, errors: e1 } = toPayload(p.fields, vals);
    const e2 = zodErrors(p.schema.safeParse(payload)); const e3 = p.extraValidate?.(payload) ?? {};
    const all = { ...e2, ...e3, ...e1 }; setErrors(all);
    if (Object.keys(all).length) { toast('Fix the highlighted fields', 'err'); return; }
    setSaving(true);
    try {
      const sb = supabaseBrowser();
      if (editing) await must(sb.from(p.table).update(payload).eq('id', editing.id).select('id'));
      else await must(sb.from(p.table).insert(payload).select('id'));
      toast(`${p.noun} saved`); setOpen(false); await p.reload();
    } catch (er) { toast((er as Error).message, 'err'); } finally { setSaving(false); }
  }
  async function remove(r: T) {
    try { await must(supabaseBrowser().from(p.table).update({ deleted_at: new Date().toISOString() }).eq('id', r.id).select('id')); toast(`${p.noun} removed`); await p.reload(); }
    catch (er) { toast((er as Error).message, 'err'); }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-semibold">{p.title}</h2><Button size="sm" onClick={openNew}><Plus size={14} /> Add {p.noun.toLowerCase()}</Button></div>
      {p.intro}
      {p.rows.length === 0 ? <EmptyState title={`No ${p.noun.toLowerCase()} records yet`} hint={p.emptyHint} action={<Button size="sm" onClick={openNew}>Add {p.noun.toLowerCase()}</Button>} /> : (
        <ul className="space-y-2">
          {p.rows.map((r) => (
            <li key={r.id}><Card className="space-y-2">
              <div>{p.summary(r)}</div>
              <div className="flex flex-wrap items-center gap-3 border-t pt-2">
                <VerifyToggle k={verifyKey(p.section, r.id)} ver={p.ver} />
                <div className="ml-auto flex gap-2"><Button size="sm" variant="secondary" onClick={() => openEdit(r)}>Edit</Button><ConfirmButton size="sm" variant="ghost" message={`Remove this ${p.noun.toLowerCase()} record?`} onConfirm={() => remove(r)}>Remove</ConfirmButton></div>
              </div>
            </Card></li>
          ))}
        </ul>
      )}
      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`${editing ? 'Edit' : 'Add'} ${p.noun.toLowerCase()}`} wide>
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            {p.fields.filter((f) => !f.showWhen || f.showWhen(vals)).map((f) => <Control key={f.name} f={f} vals={vals} set={set} err={errors[f.name]} />)}
          </div>
          <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
        </form>
      </Modal>
    </div>
  );
}

/** One-row-per-user form (personal details, career goals, narrative) with a per-field verification toggle. */
export function SingleForm(p: {
  section: SectionKey; fields: FDef[]; initial: Vals; schema: z.ZodType; ver: Verification; save: (payload: Record<string, unknown>) => Promise<void>; title: string; intro?: ReactNode;
}) {
  const toast = useToast(); const [vals, setVals] = useState<Vals>(p.initial); const [errors, setErrors] = useState<Record<string, string>>({}); const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setVals((s) => ({ ...s, [k]: v }));
  async function submit() {
    if (saving) return;
    const { payload, errors: e1 } = toPayload(p.fields, vals); const all = { ...zodErrors(p.schema.safeParse(payload)), ...e1 }; setErrors(all);
    if (Object.keys(all).length) { toast('Fix the highlighted fields', 'err'); return; }
    setSaving(true);
    try { await p.save(payload); toast('Saved'); } catch (er) { toast((er as Error).message, 'err'); } finally { setSaving(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4" noValidate>
      <div><h2 className="font-semibold">{p.title}</h2>{p.intro}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        {p.fields.map((f) => (
          <div key={f.name} className={f.wide || f.type === 'textarea' || f.type === 'list' ? 'space-y-1 sm:col-span-2' : 'space-y-1'}>
            <Control f={{ ...f, wide: false }} vals={vals} set={set} err={errors[f.name]} />
            <VerifyToggle k={verifyKey(p.section, f.name)} ver={p.ver} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3"><Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button><Badge>Fields marked "needs verification" keep the section from showing as complete.</Badge></div>
    </form>
  );
}

export { currentUserId };
