import { redirect } from 'next/navigation';

/** Old deep links (/applications/<id>) open the same application in the two-pane view. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/applications?a=${encodeURIComponent(id)}`);
}
