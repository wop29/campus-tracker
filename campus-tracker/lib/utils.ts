import clsx, { type ClassValue } from 'clsx';
export const cn = (...a: ClassValue[]) => clsx(a);
export const fmtDate = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '-');
export const fmtDateTime = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '-');
export const fmtMoney = (n?: number | null, currency = 'USD') => (n == null ? '-' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n));
export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export const num = (v: string | number | null | undefined) => (v === '' || v == null ? null : Number(v));
