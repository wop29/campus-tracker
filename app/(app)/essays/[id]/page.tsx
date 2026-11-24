'use client';
import { useParams } from 'next/navigation';
import { EssayEditor } from '@/components/essays/EssayEditor';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <EssayEditor essayId={id} />;
}
