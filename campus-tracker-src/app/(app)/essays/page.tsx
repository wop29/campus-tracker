'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import { cn } from '@/lib/utils';
import { EssaysTab } from '@/components/essays/EssaysTab';
import { StoryBankTab } from '@/components/essays/StoryBankTab';
import { DocumentsTab } from '@/components/essays/DocumentsTab';

const TABS = [{ id: 'essays', label: 'Essays' }, { id: 'stories', label: 'Story Bank' }, { id: 'documents', label: 'Documents' }] as const;
export default function Page() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('essays');
  return (
    <div>
      <PageHeader title="Essays & Documents" subtitle="Draft essays with full version history, keep your stories organised, and store your application documents." />
      <div role="tablist" aria-label="Essays and documents" className="mb-4 flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`} onClick={() => setTab(t.id)}
            className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', tab === t.id ? 'border-accent text-accent' : 'border-transparent text-secondary hover:text-primary')}>{t.label}</button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'essays' && <EssaysTab />}{tab === 'stories' && <StoryBankTab />}{tab === 'documents' && <DocumentsTab />}
      </div>
    </div>
  );
}
