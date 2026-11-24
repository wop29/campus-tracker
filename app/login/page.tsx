'use client';
import { useState } from 'react';
import { APP_NAME } from '@/lib/constants';
import { useRouter } from 'next/navigation';
import { supabaseBrowser, supabaseConfigured } from '@/lib/supabase/client';
import { Button, Card, Field, Input } from '@/components/ui';
import { Mascot } from '@/components/mascot';
import { ThemeLoader } from '@/components/theme/theme-loader';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (!supabaseConfigured()) return <div className="mx-auto max-w-md p-10 text-sm">Supabase is not configured. See README.md (Setup).</div>;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setInfo(null); setBusy(true);
    const sb = supabaseBrowser();
    if (mode === 'up') {
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
      if (error) setError(error.message);
      else if (!data.session) setInfo('Check your email to confirm your account, then sign in.');
      else router.replace('/');
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) setError(error.message); else router.replace('/');
    }
    setBusy(false);
  }
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-4 md:flex-row md:gap-14">
      <ThemeLoader fromDb={false} />
      <div className="max-w-sm text-center md:text-left">
        <div className="flex justify-center md:justify-start"><Mascot pose="wave" size={150} alt="Mochi, the Campus Quest mascot, waving hello" priority animate /></div>
        <p className="mt-3 text-3xl font-extrabold tracking-tight text-ink">Your path to university, one small win at a time.</p>
        <p className="mt-2 text-sm text-secondary">Track schools, essays and deadlines in one friendly place.</p>
      </div>
      <Card className="w-full max-w-sm space-y-4">
        <div><h1 className="text-xl font-extrabold">{APP_NAME}</h1><p className="text-sm text-secondary">{mode === 'in' ? 'Sign in to your account' : 'Create your account'}</p></div>
        <form onSubmit={submit} className="space-y-3">
          <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
          <Field label="Password" hint={mode === 'up' ? 'At least 8 characters' : undefined}><Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} /></Field>
          {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}
          {info && <p className="text-sm font-medium text-success">{info}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait...' : mode === 'in' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <button className="text-sm font-bold text-accent underline" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}>{mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}</button>
      </Card>
    </div>
  );
}
