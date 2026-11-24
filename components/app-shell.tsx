'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { HeaderExtras } from '@/components/header-extras';
import { ToastProvider } from '@/components/toast';
import { supabaseBrowser, supabaseConfigured } from '@/lib/supabase/client';
import { Button, Loading } from '@/components/ui';
import { Mascot } from '@/components/mascot';
import { ThemeLoader } from '@/components/theme/theme-loader';
import { parseOnboarding } from '@/lib/onboarding';
import { ONBOARDING_DONE_EVENT } from '@/components/onboarding/data';

const WELCOME = '/welcome';

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);
  // null while we check; true sends the user to the first-run welcome until they finish or skip it.
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const configured = supabaseConfigured();
  useEffect(() => {
    if (!configured) return;
    const sb = supabaseBrowser();
    void sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace('/login'); return; }
      setEmail(data.user.email ?? null);
      // First login: create the school research list (names only, no statistics).
      const { count } = await sb.from('schools').select('id', { count: 'exact', head: true });
      if (!count) await sb.rpc('seed_my_schools');
      // First run: send new users to the short welcome. A failed read never locks anyone out.
      try {
        const { data: row, error } = await sb.from('applicant_profiles').select('settings').eq('user_id', data.user.id).maybeSingle();
        setNeedsOnboarding(error ? false : !parseOnboarding(row?.settings).done);
      } catch { setNeedsOnboarding(false); }
    });
  }, [configured, router]);
  useEffect(() => {
    const done = () => setNeedsOnboarding(false);
    window.addEventListener(ONBOARDING_DONE_EVENT, done);
    return () => window.removeEventListener(ONBOARDING_DONE_EVENT, done);
  }, []);
  useEffect(() => {
    if (needsOnboarding && pathname !== WELCOME) router.replace(WELCOME);
  }, [needsOnboarding, pathname, router]);
  const onWelcome = pathname === WELCOME;
  if (!configured) {
    return (
      <div className="mx-auto max-w-xl p-10"><ThemeLoader fromDb={false} /><Mascot pose="thinking" size={96} priority /><h1 className="text-2xl font-extrabold">Setup required</h1>
        <p className="mt-2 text-sm text-secondary">Supabase is not configured. Copy <code>.env.example</code> to <code>.env.local</code>, set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>, run the SQL in <code>supabase/migrations</code>, then restart. See README.md.</p></div>
    );
  }
  if (onWelcome) {
    return (
      <ToastProvider>
        <ThemeLoader />
        <main className="flex min-h-screen overflow-auto bg-bg">{children}</main>
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <ThemeLoader />
      <div className="flex h-screen">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="m-3 mb-0 flex h-14 shrink-0 items-center justify-end gap-3 rounded-2xl border-2 bg-surface px-4 pl-14 shadow-[0_3px_0_var(--color-border)] md:pl-4">
            <HeaderExtras />
            <span className="hidden text-xs text-secondary sm:inline">{email}</span>
            <Button variant="secondary" size="sm" onClick={async () => { await supabaseBrowser().auth.signOut(); router.replace('/login'); }}>Sign out</Button>
          </header>
          <main className="flex-1 overflow-auto p-4 md:p-6">{needsOnboarding === true && pathname !== WELCOME ? <Loading label="Getting things ready..." /> : children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
