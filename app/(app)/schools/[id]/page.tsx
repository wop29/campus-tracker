'use client';
import { useParams } from 'next/navigation';
import { SchoolDetail } from '@/components/schools/detail';

export default function SchoolPage() {
  const { id } = useParams<{ id: string }>();
  return <SchoolDetail id={id} />;
}
