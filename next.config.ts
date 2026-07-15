import type {NextConfig} from 'next';

const isDevelopment = process.env.NODE_ENV === 'development';

// Content Security Policy for XSS protection
// Note: 'unsafe-inline' is required for React/Next.js client components due to useTransition and state management
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data: https:;
  font-src 'self';
  connect-src 'self' https://api.steampowered.com;
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
`.replace(/\n/g, '').trim();

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

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