'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loading } from '@/components/ui';
import { PortfolioList } from '@/components/schools/portfolio';
import { CompareView } from '@/components/schools/compare';
import { ResearchView } from '@/components/schools/research';
import { CatalogueView } from '@/components/schools/catalogue';

// ?view=find (default) researched catalogue · mine: the student's list · portfolio: list filtered to the shortlist (older links) · compare · research
function Switch() {
  const view = useSearchParams().get('view');
  if (view === 'compare') return <CompareView />;
  if (view === 'research') return <ResearchView />;
  if (view === 'mine' || view === 'all') return <PortfolioList portfolioOnly={false} />;
  if (view === 'portfolio') return <PortfolioList portfolioOnly />;
  return <CatalogueView />;
}
export default function SchoolsPage() { return <Suspense fallback={<Loading />}><Switch /></Suspense>; }
