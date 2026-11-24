'use client';
import Link from 'next/link';
import { Card } from '@/components/ui';
import type { Kpis } from '@/lib/overview-logic';

export function KpiCards({ k }: { k: Kpis; base?: string }) {
  const cards: { label: string; value: string | number; sub?: string; href: string }[] = [
    { label: 'Target Schools', value: k.targetSchools, href: '/schools?view=portfolio' },
    { label: 'In progress', value: k.inProgress, href: '/applications?filter=in_progress' },
    { label: 'Submitted', value: k.submitted, href: '/applications?filter=submitted' },
    { label: 'Deadlines soon', value: k.upcomingDeadlines, sub: k.overdueDeadlines ? `${k.overdueDeadlines} overdue, not submitted` : 'Next 30 days', href: '/applications?filter=deadlines' },
  ];
  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.label} href={c.href} className="group block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <Card className="h-full transition group-hover:border-accent">
            <p className="text-xs font-medium text-secondary">{c.label}</p>
            <p className={typeof c.value === 'number' ? 'mt-1 text-2xl font-semibold' : 'mt-1 text-lg font-semibold'}>{c.value}</p>
            {c.sub && <p className="mt-0.5 text-xs text-secondary">{c.sub}</p>}
          </Card>
        </Link>
      ))}
    </section>
  );
}
