import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/**
 * `next/link` with viewport prefetching off by default.
 *
 * Every route is dynamic: the root layout reads `headers()` for the CSP nonce
 * and sets `force-dynamic`, so a prefetch has no cacheable shell for the router
 * to store. It re-issues one for every visible link instead, forever, at network
 * speed: a link-dense page sustains ~400 RSC requests/second and burns the whole
 * prefetch rate-limit budget in about two seconds. Hovering still prefetches,
 * which is where the navigation intent actually is.
 *
 * Pass `prefetch` explicitly to override.
 */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
