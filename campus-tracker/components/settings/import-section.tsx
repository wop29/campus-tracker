'use client';
import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { useToast } from '@/components/toast';
import { supabaseBrowser } from '@/lib/supabase/client';
import { MAX_IMPORT_BYTES, parseBackup, runImport, supabaseExecutor, type Backup, type ImportReport, type Preview } from '@/lib/import';
import { titleCase } from '@/lib/utils';

/** Restore from a JSON backup made by "Download full backup". Merge only: existing rows are never overwritten or deleted. */
export function ImportSection() {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<{ backup: Backup; preview: Preview } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const reset = () => { setParsed(null); setConfirmed(false); setError(null); setReport(null); setFileName(''); if (fileRef.current) fileRef.current.value = ''; };

  const onFile = async (f: File | undefined) => {
    setParsed(null); setConfirmed(false); setError(null); setReport(null);
    if (!f) return;
    setFileName(f.name);
    if (f.size > MAX_IMPORT_BYTES) { setError('That file is larger than 25 MB, so it is not a backup from this app.'); return; }
    const r = parseBackup(await f.text());
    if (!r.ok) { setError(r.error); return; }
    setParsed({ backup: r.backup, preview: r.preview });
  };

  const run = async () => {
    if (!parsed || !confirmed || busy) return;
    setBusy(true); setProgress('Starting...');
    try {
      const sb = supabaseBrowser();
      const { data, error: authErr } = await sb.auth.getUser();
      if (authErr || !data.user) throw new Error('You need to be signed in to import.');
      const rep = await runImport(parsed.backup, data.user.id, supabaseExecutor(sb), (d, t, table) => setProgress(table === 'done' ? 'Finishing...' : `Restoring ${titleCase(table)} (${d + 1} of ${t})`));
      setReport(rep); setParsed(null); setConfirmed(false);
      toast(rep.failed ? `Import finished with ${rep.failed} failed rows` : `Import finished: ${rep.inserted} rows added, ${rep.skipped} skipped`, rep.failed ? 'err' : 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false); setProgress(null);
  };

  return (
    <Card className="mb-4">
      <h2 className="text-base font-semibold">Restore from a backup</h2>
      <p className="mb-3 mt-0.5 text-xs text-secondary">Load a JSON file from &quot;Download full backup&quot; into this account, for example after moving to a new Supabase project. Rows are added to what you already have. Nothing is overwritten or deleted.</p>
      <ul className="mb-3 list-disc space-y-1 pl-5 text-xs text-secondary">
        <li>Everything is assigned to the account you are signed in with now. Record IDs are kept so links between records stay intact.</li>
        <li>Rows whose ID already exists are skipped. Importing the same file twice changes nothing.</li>
        <li>Not restored: the activity log, notifications and XP history, which the app rebuilds.</li>
        <li><strong>Uploaded files are not included in a backup and cannot be restored here.</strong> Your document records come back, but the files must be copied between Supabase Storage buckets separately (see docs/MIGRATING.md).</li>
        <li>This account already has the default school list if you have opened the app before. Importing adds your own schools next to it, so you may see duplicate names to delete.</li>
      </ul>
      <input ref={fileRef} type="file" accept="application/json,.json" className="block text-sm" aria-label="Backup file" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
      {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}

      {parsed && (
        <div className="mt-4">
          <p className="text-sm"><strong>{fileName}</strong>: backup made {new Date(parsed.preview.exportedAt).toLocaleString()}, {parsed.preview.totalRows} rows to restore.</p>
          <table className="mt-2 w-full max-w-md text-sm">
            <thead><tr className="text-left text-xs text-secondary"><th className="py-1 font-medium">Table</th><th className="py-1 text-right font-medium">Rows</th></tr></thead>
            <tbody>{parsed.preview.counts.map((c) => <tr key={c.table} className="border-t"><td className="py-1">{titleCase(c.table)}</td><td className="py-1 text-right tabular-nums">{c.rows}</td></tr>)}</tbody>
          </table>
          {parsed.preview.skipped.length > 0 && <p className="mt-2 text-xs text-secondary">Skipped: {parsed.preview.skipped.map((s) => `${titleCase(s.table)} (${s.rows}, ${s.reason})`).join('; ')}.</p>}
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
            <span>I understand that this adds these records to my current account and that uploaded files are not restored.</span>
          </label>
          <div className="mt-3 flex gap-2">
            <Button onClick={run} disabled={!confirmed || busy}><Upload size={14} /> {busy ? 'Importing...' : 'Import into this account'}</Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
      {progress && <p className="mt-2 text-xs text-secondary" role="status">{progress}</p>}

      {report && (
        <div className="mt-4" role="status">
          <p className="text-sm font-medium">Added {report.inserted}, skipped {report.skipped}, failed {report.failed}.</p>
          <table className="mt-2 w-full max-w-xl text-sm">
            <thead><tr className="text-left text-xs text-secondary"><th className="py-1 font-medium">Table</th><th className="py-1 text-right font-medium">Added</th><th className="py-1 text-right font-medium">Skipped</th><th className="py-1 text-right font-medium">Failed</th></tr></thead>
            <tbody>{report.tables.map((t) => (
              <tr key={t.table} className="border-t align-top"><td className="py-1">{titleCase(t.table)}{t.errors.length > 0 && <div className="text-xs text-secondary">{t.errors[0]}</div>}</td>
                <td className="py-1 text-right tabular-nums">{t.inserted}</td><td className="py-1 text-right tabular-nums">{t.skipped}</td><td className="py-1 text-right tabular-nums">{t.failed}</td></tr>
            ))}</tbody>
          </table>
          {report.notes.map((n) => <p key={n} className="mt-2 text-xs text-secondary">{n}</p>)}
          <p className="mt-2 text-xs text-secondary">Reload the page to see the restored data.</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={reset}>Done</Button>
        </div>
      )}
    </Card>
  );
}
