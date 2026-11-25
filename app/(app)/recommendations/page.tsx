import { redirect } from 'next/navigation';

// Hidden: recommendation letters are tracked as checklist items on each application. The old screen lives in git history and components/recs.
export default function Page() { redirect('/applications'); }
