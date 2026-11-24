'use client';
import { useState } from 'react';
import { Button, Card, Input } from '@/components/ui';
import { useToast } from '@/components/toast';

export function BaseCurrencyBanner({ base, isSet, onSave, saving }: { base: string; isSet: boolean; onSave: (c: string) => Promise<string | null>; saving: boolean }) {
  const toast = useToast(); const [v, setV] = useState(base); const [err, setErr] = useState<string | null>(null);
  if (isSet) return null;
  return (
    <Card className="mb-4 border-warning/40 bg-warning/5">
      <p className="text-sm font-medium">Choose your base currency</p>
      <p className="mt-0.5 text-sm text-secondary">Totals are shown in one base currency. Until you save one, USD is used. Expenses in other currencies are converted only when you record an exchange rate.</p>
      <form className="mt-3 flex flex-wrap items-start gap-2" onSubmit={async (e) => { e.preventDefault(); const m = await onSave(v); setErr(m); if (!m) toast('Base currency saved'); else toast(m, 'err'); }}>
        <div><Input aria-label="Base currency code" value={v} maxLength={3} onChange={(e) => setV(e.target.value.toUpperCase())} className="w-24" />{err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}</div>
        <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save base currency'}</Button>
      </form>
    </Card>
  );
}
