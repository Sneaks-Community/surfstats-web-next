'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { getMapImagesUrl, DEFAULT_DISPLAY_TZ } from './utils';

/**
 * Server env values that client components need.
 *
 * These have to come through a provider rather than `process.env`: the vars are
 * read at runtime on the server and are absent in the browser, and a
 * `NEXT_PUBLIC_` var would be baked in at image-build time instead of being
 * configurable per deployment.
 */
interface ClientConfig {
  mapImagesUrl: string;
  displayTz: string;
}

const ClientConfigContext = createContext<ClientConfig | null>(null);

export function ClientConfigProvider({
  children,
  mapImagesUrl,
  displayTz,
}: {
  children: ReactNode;
  mapImagesUrl: string;
  displayTz: string;
}) {
  return (
    <ClientConfigContext.Provider value={{ mapImagesUrl, displayTz }}>
      {children}
    </ClientConfigContext.Provider>
  );
}

export function useMapImagesUrl() {
  // Fallback to default if used outside provider
  return useContext(ClientConfigContext)?.mapImagesUrl || getMapImagesUrl();
}

/**
 * The display timezone to pass to `formatDate`.
 *
 * Matches what the server rendered, so a formatted date is identical either side
 * of hydration.
 */
export function useDisplayTz() {
  return useContext(ClientConfigContext)?.displayTz || DEFAULT_DISPLAY_TZ;
}
