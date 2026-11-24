'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, PageHeader, Select, Field } from '@/components/ui';
import { useToast } from '@/components/toast';
import { must, useQuery } from '@/lib/hooks';
import { supabaseBrowser } from '@/lib/supabase/client';
import { CATEGORY_LABEL, NOTIFICATIONS_CHANGED, NOTIFICATION_CATEGORIES } from '@/lib/notifications';
import { fmtDateTime } from '@/lib/utils';

type N = { id: string; category: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };

export default function NotificationsPage() {
  const toast = useToast();
  const q = useQuery<N[]>((sb) => sb.from('notifications').select('id,category,title,body,link,read_at,created_at').order('created_at', { ascending: false }).limit(500), []);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState(false);
  const all = q.data ?? [];
  const list = useMemo(() => all.filter((n) => (!category || n.category === category) && (status === 'all' || !n.read_at)), [all, category, status]);
  const unread = all.filter((n) => !n.read_at).length;
  const grouped = useMemo(() => {
    const m = new Map<string, N[]>();
    for (const n of list) m.set(n.category, [...(m.get(n.category) ?? []), n]);
    return [...m];
  }, [list]);

  const changed = () => { window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED)); return q.reload(); };
  const mark = async (ids: string[] | 'all', read: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const sb = supabaseBrowser();
      const patch = { read_at: read ? new Date().toISOString() : null };
      let query = sb.from('notifications').update(patch).select('id');
      query = ids === 'all' ? query.is('read_at', null) : query.in('id', ids);
      await must(query);
      await changed(); if (ids === 'all') toast('All notifications marked as read');
    } catch (e) { toast((e as Error).message, 'err'); }
    setBusy(false);
  };

  return (
    <div>
      <PageHeader title="Notifications" subtitle="In-app only. No emails or calendar events are sent." actions={<Button variant="secondary" disabled={busy || unread === 0} onClick={() => mark('all', true)}>Mark all as read</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="Category" className="w-52"><Select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{NOTIFICATION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</Select></Field>
        <Field label="Show" className="w-44"><Select value={status} onChange={(e) => setStatus(e.target.value as 'all' | 'unread')}><option value="all">All</option><option value="unread">Unread only ({unread})</option></Select></Field>
      </div>
      {q.loading ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={() => void q.reload()} /> : all.length === 0 ? (
        <EmptyState title="No notifications yet" hint="Reminders appear here when deadlines, tasks or interviews need attention. They are generated when you open the Overview." action={<Link href="/" className="text-sm text-accent underline">Go to Overview</Link>} />
      ) : list.length === 0 ? <EmptyState title="Nothing matches these filters" /> : (
        <div className="space-y-5">
          {grouped.map(([cat, items]) => (
            <section key={cat} aria-label={CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat}>
              <h2 className="mb-2 text-sm font-semibold">{CATEGORY_LABEL[cat as keyof typeof CATEGORY_LABEL] ?? cat} <span className="font-normal text-secondary">({items.length})</span></h2>
              <ul className="space-y-2">
                {items.map((n) => (
                  <li key={n.id}><Card className={`flex flex-wrap items-start justify-between gap-3 p-3 ${n.read_at ? '' : 'border-accent/40 bg-accent/5'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">{n.title}{!n.read_at && <Badge tone="accent">New</Badge>}</p>
                      {n.body && <p className="text-sm text-secondary">{n.body}</p>}
                      <p className="mt-0.5 text-xs text-secondary/70">{fmtDateTime(n.created_at)}</p>
                    </div>
                    <div className="flex gap-1.5">
                      {n.link && <Link href={n.link} className="inline-flex items-center rounded-md border bg-white px-2.5 py-1 text-xs font-medium hover:bg-bg" onClick={() => { if (!n.read_at) void mark([n.id], true); }}>Open</Link>}
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => mark([n.id], !n.read_at)}>{n.read_at ? 'Mark unread' : 'Mark read'}</Button>
                    </div>
                  </Card></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
