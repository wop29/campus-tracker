'use client';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
type T = { id: number; msg: string; tone: 'ok' | 'err' };
const Ctx = createContext<(msg: string, tone?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(Ctx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((msg: string, tone: 'ok' | 'err' = 'ok') => {
    const id = Date.now() + Math.random(); setItems((s) => [...s, { id, msg, tone }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), tone === 'err' ? 7000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={push}>{children}
      <div className="fixed bottom-4 right-4 z-[60] max-w-sm space-y-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.tone === 'err' ? 'alert' : 'status'} className={`toast-in flex items-start gap-2 rounded-2xl border-2 border-b-4 px-3 py-2.5 text-sm font-bold text-white shadow-lg ${t.tone === 'err' ? 'border-danger-ink bg-danger' : 'border-success-ink bg-success'}`}>
            {t.tone === 'err' ? <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden /> : <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
