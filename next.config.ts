import type { NextConfig } from 'next';
const config: NextConfig = {
  turbopack: {root: __dirname},
  poweredByHeader: false,
  async headers() {
    return [{source: '/:path*', headers: [
      {key: 'Referrer-Policy', value: 'no-referrer'},
      {key: 'X-Content-Type-Options', value: 'nosniff'},
      {key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : "") + "; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"},
    ]}];
  },
};
export default config;
