'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { getMapImagesUrl } from './utils';

const MapImagesUrlContext = createContext<string>('');

export function MapImagesUrlProvider({ 
  children, 
  url 
}: { 
  children: ReactNode; 
  url: string; 
}) {
  return (
    <MapImagesUrlContext.Provider value={url}>
      {children}
    </MapImagesUrlContext.Provider>
  );
}

export function useMapImagesUrl() {
  const url = useContext(MapImagesUrlContext);
  if (!url) {
    // Fallback to default if used outside provider
    return getMapImagesUrl();
  }
  return url;
}