import type { NextConfig } from 'next';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://127.0.0.1:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Same-origin API: a phone on the Wi-Fi reaches the backend through this app, no CORS needed.
  rewrites: async () => [{ source: '/api/:path*', destination: `${GATEWAY}/:path*` }],
  headers: async () => [
    {
      source: '/sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache' },
        { key: 'Service-Worker-Allowed', value: '/' },
      ],
    },
    {
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'microphone=(self), camera=(self), geolocation=()' },
      ],
    },
  ],
};

export default config;
