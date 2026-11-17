import './globals.css';
import { ThemeBootScript } from '@/components/theme/boot-script';
import type { Metadata, Viewport } from 'next';
export const metadata: Metadata = { title: 'MBA Admissions OS', description: 'Personal MBA admissions command center',
  manifest: '/manifest.webmanifest', icons: { apple: '/icons/apple-touch-icon.png' }, appleWebApp: { capable: true, title: 'MBA OS', statusBarStyle: 'default' } };
export const viewport: Viewport = { themeColor: '#1A64B0' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return (<html lang="en" suppressHydrationWarning><head><ThemeBootScript /></head><body>{children}</body></html>); }
