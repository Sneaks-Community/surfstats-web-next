import type {NextConfig} from 'next';
import { STATIC_SECURITY_HEADERS } from './lib/security-headers';

// The CSP is not here: it carries a per-request nonce and is set by proxy.ts.
const securityHeaders = Object.entries(STATIC_SECURITY_HEADERS).map(([key, value]) => ({
  key,
  value,
}));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  output: 'standalone',
};

export default nextConfig;