import type { NextConfig } from 'next';
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
];
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',   // smallest self-hostable build; used by the Dockerfile
  headers: async () => [{ source: '/(.*)', headers: securityHeaders }],
};
export default config;
