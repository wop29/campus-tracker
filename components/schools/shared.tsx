'use client';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui';
import { dataFlags, type DataRow } from '@/lib/schools';
import { cn } from '@/lib/utils';
import { aiEnabled } from '@/lib/features';

export interface SchoolRow {
  id: string; name: string; short_name: string | null; country: string | null; location: string | null; website_url: string | null; admissions_url: string | null;
  tier: string | null; in_portfolio: boolean; priority: number; notes: string | null; ranking: number | null;
}
export const SCHOOL_COLS = 'id, name, short_name, country, location, website_url, admissions_url, tier, in_portfolio, priority, notes, ranking';

export function DataBadges({ row }: { row: Pick<DataRow, 'verification_status' | 'publication_year'> }) {
  const f = dataFlags(row);
  return (
    <span className="inline-flex flex-wrap gap-1">
      {f.unverified && <Badge tone="warning">Unverified</Badge>}
      {row.verification_status === 'verified' && <Badge tone="success">Verified</Badge>}
      {f.outdated && <Badge tone="danger">{f.outdatedByYear ? 'Possibly outdated (older than 2 years)' : 'Marked outdated'}</Badge>}
      {f.yearUnknown && <Badge>Year unknown</Badge>}
    </span>
  );
}
export const SourceLink = ({ name, url }: { name: string; url: string }) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">{name}<ExternalLink size={12} aria-hidden /></a>
);

const VIEWS = [{ key: 'find', label: 'Find universities', href: '/schools?view=find' }, { key: 'mine', label: 'My list', href: '/schools?view=mine' }, { key: 'compare', label: 'Compare', href: '/schools?view=compare' }, { key: 'research', label: 'Research assistant', href: '/schools?view=research' }];
/** Older tab bar, kept for compatibility. New pages use CatalogueNav from ./catalogue-nav. */
export function SchoolsNav({ active }: { active: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b" aria-label="School views">
      {VIEWS.filter((v) => v.key !== 'research' || aiEnabled() || active === 'research').map((v) => <Link key={v.key} href={v.href} aria-current={active === v.key ? 'page' : undefined} className={cn('-mb-px border-b-2 px-3 py-2 text-sm', active === v.key ? 'border-accent font-medium text-primary' : 'border-transparent text-secondary hover:text-primary')}>{v.label}</Link>)}
    </nav>
  );
}
export const TIER_NOTE = 'Your tier should reflect your own strategy and chances as you see them, not only a ranking.';
