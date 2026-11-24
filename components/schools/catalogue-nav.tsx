'use client';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { aiEnabled } from '@/lib/features';

export type SchoolsView = 'find' | 'mine' | 'compare' | 'research';
const VIEWS: { key: SchoolsView; label: string; href: string }[] = [
  { key: 'find', label: 'Find universities', href: '/schools?view=find' },
  { key: 'mine', label: 'My list', href: '/schools?view=mine' },
  { key: 'compare', label: 'Compare', href: '/schools?view=compare' },
  { key: 'research', label: 'Research assistant', href: '/schools?view=research' },
];

/** Tabs across the top of the universities pages. */
export function CatalogueNav({ active }: { active: SchoolsView }) {
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b" aria-label="University views">
      {VIEWS.filter((v) => v.key !== 'research' || aiEnabled()).map((v) => (
        <Link key={v.key} href={v.href} aria-current={active === v.key ? 'page' : undefined}
          className={cn('-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm', active === v.key ? 'border-accent font-bold text-primary' : 'border-transparent text-secondary hover:text-primary')}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}
