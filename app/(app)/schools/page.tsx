'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loading } from '@/components/ui';
import { PortfolioList } from '@/components/schools/portfolio';
import { CompareView } from '@/components/schools/compare';
import { ResearchView } from '@/components/schools/research';

function Switch() {
  const view = useSearchParams().get('view');
  if (view === 'compare') return <CompareView />;
  if (view === 'research') return <ResearchView />;
  return <PortfolioList portfolioOnly={view === 'portfolio'} />;
}
export default function SchoolsPage() { return <Suspense fallback={<Loading />}><Switch /></Suspense>; }
