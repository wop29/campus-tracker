import './globals.css';
import { ThemeBootScript } from '@/components/theme/boot-script';
import type { Metadata, Viewport } from 'next';
import { APP_NAME, APP_TAGLINE } from '@/lib/constants';
export const metadata: Metadata = { title: APP_NAME, description: APP_TAGLINE,
  manifest: '/manifest.webmanifest', icons: { apple: '/icons/apple-touch-icon.png' }, appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'default' } };
export const viewport: Viewport = { themeColor: '#1A64B0' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html lang="en" suppressHydrationWarning><head><ThemeBootScript /></head><body>{children}</body></html>); }
