import { BOOT_SCRIPT } from './themes';
/** Optional: render once inside <head> in app/layout.tsx (and add suppressHydrationWarning to <html>) to avoid a first-paint flash. */
export function ThemeBootScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />;
}
