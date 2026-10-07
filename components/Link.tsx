import NextLink from 'next/link';
import type { ComponentProps } from 'react';

/** `next/link` with prefetch off (viewport and hover) unless `prefetch` is set. Routes are dynamic
 * (`force-dynamic` root layout reads `headers()` for the CSP nonce), so prefetches have no cacheable
 * shell; the router re-issues one per visible link forever (~400 RSC req/s on a dense page, draining
 * the prefetch rate limit in ~2s). */
export default function Link(props: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />;
}
