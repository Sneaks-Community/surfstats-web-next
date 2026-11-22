import 'server-only';
import { getEnv } from './env';
import { SITE_NAME } from './utils';

/** Reference to the organization behind the site, whose full markup lives on its own website: no logo,
 * `sameAs` or description here, so there's one source of truth. Null unless a name and URL are set. */
function publisherRef() {
  const { ORG_NAME, ORG_URL } = getEnv();
  const orgUrl = ORG_URL ?? process.env.NEXT_PUBLIC_MAIN_SITE_URL;
  if (!ORG_NAME || !orgUrl || !URL.canParse(orgUrl)) return null;
  const url = new URL(orgUrl).href;
  return { '@type': 'Organization', '@id': new URL('#organization', url).href, name: ORG_NAME, url };
}

/** Homepage `WebSite` node: Google reads a subdomain's site name from it. `siteUrl` has no trailing slash. */
export function websiteJsonLd(siteUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${siteUrl}/`,
    publisher: publisherRef() ?? undefined,
  };
}

/** For a `<script type="application/ld+json">`: escaping `<` stops a configured value from closing the tag. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
