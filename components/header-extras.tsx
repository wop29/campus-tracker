'use client';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Bell, Search } from 'lucide-react';
import { supabaseBrowser } from '@/lib/supabase/client';
import { NOTIFICATIONS_CHANGED } from '@/lib/notifications';
import { fmtDateTime } from '@/lib/utils';
import { GamificationChips } from '@/components/gamification/chips';

type N = { id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  useEffect(() => { setQ(params.get('q') ?? ''); }, [params]);
  return (
    <form role="search" className="relative" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); if (t) router.push(`/search?q=${encodeURIComponent(t)}`); }}>
      <label htmlFor="global-search" className="sr-only">Search schools, programs, applications, essays</label>
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-secondary" aria-hidden />
      <input id="global-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search schools, programs, applications, essays" maxLength={100}
        className="w-44 rounded-md border bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent sm:w-64" />
    </form>
  );
}

function Bell_() {
  const pathname = usePathname();
  const [unread, setUnread] = useState<number | null>(null);
  const [items, setItems] = useState<N[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const sb = supabaseBrowser();
    const [c, l] = await Promise.all([
      sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
      sb.from('notifications').select('id,title,body,link,read_at,created_at').order('created_at', { ascending: false }).limit(8),
    ]);
    if (c.error || l.error) { setError((c.error ?? l.error)!.message); return; }
    setError(null); setUnread(c.count ?? 0); setItems((l.data ?? []) as N[]);
  }, []);
  useEffect(() => { void refresh(); }, [refresh, pathname]);
  useEffect(() => { window.addEventListener(NOTIFICATIONS_CHANGED, refresh); return () => window.removeEventListener(NOTIFICATIONS_CHANGED, refresh); }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markAll = async () => {
    if (busy) return;
    setBusy(true);
    const { error: e } = await supabaseBrowser().from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null);
    if (e) setError(e.message); else await refresh();
    setBusy(false);
  };
  const markOne = async (id: string) => { await supabaseBrowser().from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null); void refresh(); };

  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => { setOpen((o) => !o); void refresh(); }} aria-haspopup="true" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative rounded-md p-2 text-secondary hover:bg-bg">
        <Bell size={18} />
        {unread ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1 w-80 rounded-lg border bg-white shadow-xl" role="region" aria-label="Recent notifications">
          <div className="flex items-center justify-between border-b px-3 py-2"><span className="text-sm font-semibold">Notifications</span>
            <button type="button" className="text-xs text-accent underline disabled:opacity-50" disabled={busy || !unread} onClick={markAll}>Mark all read</button></div>
          {error && <p className="px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
          {!error && items.length === 0 && <p className="px-3 py-6 text-center text-sm text-secondary">No notifications yet.</p>}
          <ul className="max-h-80 divide-y overflow-auto">
            {items.map((n) => (
              <li key={n.id} className={n.read_at ? '' : 'bg-accent/5'}>
                <Link href={n.link || '/notifications'} onClick={() => { setOpen(false); if (!n.read_at) void markOne(n.id); }} className="block px-3 py-2 hover:bg-bg">
                  <span className={`block text-sm ${n.read_at ? '' : 'font-medium'}`}>{n.title}</span>
                  {n.body && <span className="block truncate text-xs text-secondary">{n.body}</span>}
                  <span className="block text-[11px] text-secondary/70">{fmtDateTime(n.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="border-t px-3 py-2 text-center"><Link href="/notifications" onClick={() => setOpen(false)} className="text-xs text-accent underline">View all notifications</Link></div>
        </div>
      )}
    </div>
  );
}

export function HeaderExtras() {
  return <><GamificationChips /><Suspense fallback={null}><SearchBox /></Suspense><Bell_ /></>;
}
