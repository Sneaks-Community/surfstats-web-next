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
  // Restrict remote images to trusted domains only
  // Note: Map images use unoptimized={true} and bypass the Next.js image proxy entirely,
  // so they are not included here. Their hostnames are configured at runtime via MAP_IMAGES_URL.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'steamcommunity.com' },
      { protocol: 'https', hostname: 'avatars.steamstatic.com' },
      { protocol: 'https', hostname: 'avatars.steamcdn.com' },
    ],
  },
  output: 'standalone',
};

export default nextConfig;