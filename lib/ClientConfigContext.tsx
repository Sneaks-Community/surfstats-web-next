'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { getMapImagesUrl, DEFAULT_DISPLAY_TZ } from './utils';

// Server runtime env for client components: `process.env` lacks it in the browser, and a
// `NEXT_PUBLIC_` var would be baked in at image-build time, not set per deployment.
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
  // Outside a provider, fall back to the default.
  return useContext(ClientConfigContext)?.mapImagesUrl || getMapImagesUrl();
}

/** Matches the server's zone, so `formatDate` output is identical across hydration. */
export function useDisplayTz() {
  return useContext(ClientConfigContext)?.displayTz || DEFAULT_DISPLAY_TZ;
}
