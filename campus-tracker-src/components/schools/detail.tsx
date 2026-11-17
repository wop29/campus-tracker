'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Plus } from 'lucide-react';
import { Badge, Button, Card, ConfirmButton, ErrorBox, Loading, PageHeader, Select } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { must } from '@/lib/hooks';
import { TIERS, TIER_LABEL } from '@/lib/constants';
import { fmtDate } from '@/lib/utils';
import { FIELD_BY_KEY, FIELD_CATALOGUE, GROUP_LABEL, GROUP_ORDER, formatValue, type DataRow, type FieldDef } from '@/lib/schools';
import { DataBadges, SCHOOL_COLS, SourceLink, TIER_NOTE, type SchoolRow } from './shared';
import { DataPointModal } from './datapoint-modal';
import { SchoolFormModal } from './school-form';
import { ProgramsSection } from './programs';

interface Program { id: string; name: string; duration_months: number | null; format: string | null }
interface Loaded { school: SchoolRow | null; program: Program | null; data: DataRow[] }

export function SchoolDetail({ id }: { id: string }) {
  const toast = useToast();
  const [st, setSt] = useState<Loaded | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [editField, setEditField] = useState<string | null>(null); const [editRow, setEditRow] = useState<DataRow | null>(null); const [dpOpen, setDpOpen] = useState(false); const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const sb = supabaseBrowser();
      const [school, progs, data] = await Promise.all([
        must(sb.from('schools').select(SCHOOL_COLS).eq('id', id).is('deleted_at', null).maybeSingle()) as Promise<SchoolRow | null>,
        must(sb.from('school_programs').select('id, name, duration_months, format').eq('school_id', id).order('created_at').limit(1)) as Promise<Program[]>,
        must(sb.from('school_admissions_data').select('*').eq('school_id', id)) as Promise<DataRow[]>,
      ]);
      setSt({ school, program: progs[0] ?? null, data }); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  async function patch(p: Partial<SchoolRow>) {
    if (busy) return; setBusy(true);
    try { await must(supabaseBrowser().from('schools').update(p).eq('id', id).select('id')); await load(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }
  async function delPoint(r: DataRow) {
    try { await must(supabaseBrowser().from('school_admissions_data').delete().eq('id', r.id).select('id')); toast('Data point deleted'); await load(); } catch (e) { toast((e as Error).message, 'err'); }
  }
  const openPoint = (field: string, row: DataRow | null) => { setEditField(field); setEditRow(row); setDpOpen(true); };

  if (error) return <ErrorBox message={error} onRetry={() => void load()} />;
  if (!st) return <Loading />;
  const { school, program, data } = st;
  if (!school) return <div className="space-y-3"><ErrorBox message="This school was not found or has been removed." /><Link href="/schools" className="text-sm text-accent underline">Back to School Portfolio</Link></div>;
  const byField = new Map(data.map((d) => [d.field, d]));
  const unknown = data.filter((d) => !FIELD_BY_KEY[d.field]);

  const Row = ({ def, r }: { def: FieldDef | undefined; r: DataRow | undefined }) => (
    <tr className="align-top">
      <td className="w-48 p-2 font-medium">{def?.label}</td>
      <td className="p-2">
        {r ? (<div className="space-y-1"><div className="whitespace-pre-wrap">{formatValue(def, r) || '-'}</div><DataBadges row={r} />
          <div className="text-xs text-secondary"><SourceLink name={r.source_name} url={r.source_url} /> | accessed {fmtDate(r.date_accessed)} | published {r.publication_year ?? 'year unknown'}</div></div>)
          : <span className="text-secondary">Not researched</span>}
      </td>
      <td className="w-40 p-2 text-right">
        {def && (r ? <div className="flex justify-end gap-1"><Button size="sm" variant="secondary" onClick={() => openPoint(def.key, r)}>Edit</Button><ConfirmButton size="sm" variant="ghost" message="Delete this data point?" onConfirm={() => delPoint(r)}>Delete</ConfirmButton></div> : <Button size="sm" variant="secondary" onClick={() => openPoint(def.key, null)}>Add data</Button>)}
        {!def && r && <ConfirmButton size="sm" variant="ghost" message="Delete this data point?" onConfirm={() => delPoint(r)}>Delete</ConfirmButton>}
      </td>
    </tr>
  );

  return (
    <div className="space-y-5">
      <Link href="/schools" className="inline-flex items-center gap-1 text-sm text-secondary hover:text-primary"><ArrowLeft size={14} /> School Portfolio</Link>
      <PageHeader title={school.name} subtitle={[school.location, school.country].filter(Boolean).join(', ') || 'Location not set'}
        actions={<><Button variant="secondary" onClick={() => setEditing(true)}>Edit general info</Button><Link href={`/applications?new=${school.id}`} className="inline-flex items-center rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-white hover:bg-secondary">Create application</Link></>} />

      <ProgramsSection schoolId={school.id} schoolName={school.name} shortName={school.short_name ?? null} />

      <Card className="space-y-3">
        <h2 className="font-semibold">General information</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-secondary">Program</dt><dd>{program?.name ?? <span className="text-secondary">Not researched</span>}</dd></div>
          <div><dt className="text-xs text-secondary">Duration</dt><dd>{program?.duration_months ? `${program.duration_months} months (entered by you)` : <span className="text-secondary">Not researched</span>}</dd></div>
          <div><dt className="text-xs text-secondary">Format</dt><dd>{program?.format ?? <span className="text-secondary">Not researched</span>}</dd></div>
          <div><dt className="text-xs text-secondary">Links</dt><dd className="flex flex-wrap gap-3">{school.website_url ? <a className="inline-flex items-center gap-1 text-accent hover:underline" href={school.website_url} target="_blank" rel="noopener noreferrer">Website <ExternalLink size={12} /></a> : null}{school.admissions_url ? <a className="inline-flex items-center gap-1 text-accent hover:underline" href={school.admissions_url} target="_blank" rel="noopener noreferrer">Admissions <ExternalLink size={12} /></a> : null}{!school.website_url && !school.admissions_url && <span className="text-secondary">No links saved</span>}</dd></div>
          {school.notes && <div className="sm:col-span-2"><dt className="text-xs text-secondary">Notes</dt><dd className="whitespace-pre-wrap">{school.notes}</dd></div>}
        </dl>
        <div className="flex flex-wrap items-end gap-4 border-t pt-3">
          <label className="space-y-1 text-xs font-medium text-secondary">Your tier<Select value={school.tier ?? ''} disabled={busy} onChange={(e) => void patch({ tier: e.target.value || null })} className="w-44 text-primary"><option value="">Unclassified</option>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</Select></label>
          <label className="space-y-1 text-xs font-medium text-secondary">Priority<Select value={school.priority} disabled={busy} onChange={(e) => void patch({ priority: Number(e.target.value) })} className="w-24 text-primary">{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</Select></label>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={school.in_portfolio} disabled={busy} onChange={(e) => void patch({ in_portfolio: e.target.checked })} /> In my portfolio</label>
        </div>
        <p className="text-xs text-secondary">{TIER_NOTE}</p>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-secondary">{data.length} of {FIELD_CATALOGUE.length} catalogue fields researched. Every value needs a source. Nothing is prefilled.</p>
        <Button size="sm" onClick={() => openPoint('', null)}><Plus size={14} /> Add data point</Button>
      </div>
      {GROUP_ORDER.map((g) => (
        <Card key={g} className="space-y-2 p-0"><h2 className="border-b px-4 py-3 font-semibold">{GROUP_LABEL[g]}</h2>
          <table className="w-full text-sm"><tbody className="divide-y">{FIELD_CATALOGUE.filter((f) => f.group === g).map((f) => <Row key={f.key} def={f} r={byField.get(f.key)} />)}</tbody></table></Card>
      ))}
      {unknown.length > 0 && <Card className="space-y-2 p-0"><h2 className="border-b px-4 py-3 font-semibold">Other data</h2><table className="w-full text-sm"><tbody className="divide-y">{unknown.map((r) => <Row key={r.id} def={undefined} r={r} />)}</tbody></table></Card>}
      <p className="text-xs text-secondary"><Badge tone="warning">Unverified</Badge> means you have not confirmed the figure against its source. Data published more than 2 years ago is flagged as possibly outdated. Check the source before relying on any figure.</p>

      <DataPointModal open={dpOpen} onClose={() => setDpOpen(false)} schoolId={school.id} field={editField ?? ''} existing={editRow} onSaved={() => void load()} />
      <SchoolFormModal open={editing} onClose={() => setEditing(false)} school={school} program={program} onSaved={() => void load()} />
    </div>
  );
}
