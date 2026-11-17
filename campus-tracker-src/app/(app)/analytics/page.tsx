import { redirect } from 'next/navigation';

// Hidden for now to keep the app simple. The old screen lives in git history and components/analytics.
export default function Page() { redirect('/profile?tab=progress'); }
