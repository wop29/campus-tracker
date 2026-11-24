'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as Icons from 'lucide-react';
import { useState } from 'react';
import { APP_NAME, NAV } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { Mascot } from '@/components/mascot';

// Full class names so Tailwind can see them. Icon tile is a bright fill with the dark on-fun glyph.
const TINTS = [
  { tile: 'bg-fun-green', pill: 'bg-fun-green/20 border-fun-green' },
  { tile: 'bg-fun-blue', pill: 'bg-fun-blue/20 border-fun-blue' },
  { tile: 'bg-fun-orange', pill: 'bg-fun-orange/20 border-fun-orange' },
  { tile: 'bg-fun-pink', pill: 'bg-fun-pink/20 border-fun-pink' },
  { tile: 'bg-fun-yellow', pill: 'bg-fun-yellow/20 border-fun-yellow' },
  { tile: 'bg-fun-purple', pill: 'bg-fun-purple/20 border-fun-purple' },
] as const;

export function Sidebar() {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = (
    <nav className="flex-1 space-y-1 overflow-y-auto p-2" aria-label="Main">
      {NAV.map((n, i) => {
        const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[n.icon] ?? Icons.Circle;
        const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
        const tint = TINTS[i % TINTS.length];
        return (
          <Link key={n.href} href={n.href} onClick={() => setMobileOpen(false)} title={n.label} aria-current={active ? 'page' : undefined}
            className={cn('flex items-center gap-3 rounded-2xl border-2 px-2 py-1.5 text-sm transition', active ? cn('font-extrabold text-ink', tint.pill) : 'border-transparent font-bold text-secondary hover:bg-bg hover:text-ink')}>
            <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-on-fun', tint.tile)} aria-hidden><Icon size={17} /></span>
            {!collapsed && <span className="truncate">{n.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <button className="btn-3d fixed left-3 top-3 z-40 rounded-2xl border-2 border-b-4 border-fun-green-dark bg-fun-green p-2 text-on-fun md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Icons.Menu size={18} /></button>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-ink/50 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={cn('z-50 flex flex-col border-r-2 bg-surface text-ink transition-all', 'fixed inset-y-0 left-0 w-64 md:static', mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0', collapsed && 'md:w-20')}>
        <div className="flex h-16 items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-2"><Mascot pose="happy" size={collapsed ? 34 : 40} decorative priority />{!collapsed && <span className="truncate text-base font-extrabold">{APP_NAME}</span>}</div>
          <button onClick={() => setCollapsed((c) => !c)} className="hidden rounded-xl p-1.5 text-secondary hover:bg-bg hover:text-ink md:block" aria-label="Collapse sidebar">{collapsed ? <Icons.ChevronsRight size={16} /> : <Icons.ChevronsLeft size={16} />}</button>
        </div>
        {nav}
      </aside>
    </>
  );
}
