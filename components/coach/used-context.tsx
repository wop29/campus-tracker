'use client';
import Link from 'next/link';
import { Badge } from '@/components/ui';

export type Used = { kind: string; id: string; label: string };
const HREF: Record<string, string> = {
  profile: '/profile', work: '/profile', leadership: '/profile', achievement: '/profile', education: '/profile', test: '/profile', career_goals: '/profile',
  story: '/essays', essay: '/essays', essays: '/essays', school: '/schools', school_data: '/schools', application: '/applications', applications: '/applications', tasks: '/applications', assessment: '/coach',
};
/** Shows exactly which records were retrieved for an answer, with a link to correct them at the source. */
export function UsedContext({ used }: { used: Used[] | undefined }) {
  if (!used) return null;
  if (!used.length) return <p className="mt-2 text-xs text-secondary">No records were used. Add your details on the <Link className="underline" href="/profile">Profile page</Link> for grounded answers.</p>;
  return (
    <details className="mt-2 text-xs text-secondary">
      <summary className="cursor-pointer select-none">Records used ({used.length})</summary>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {used.map((u) => <Link key={`${u.kind}:${u.id}`} href={HREF[u.kind] ?? '/profile'} title="Open to correct this record"><Badge tone="neutral" className="hover:border-accent">{u.label}</Badge></Link>)}
      </div>
      <p className="mt-1.5">Something wrong or outdated? Correct it at the source (Profile, Schools, Essays or Applications) and ask again.</p>
    </details>
  );
}
