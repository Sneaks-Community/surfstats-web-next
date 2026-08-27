'use client';

import Image from 'next/image';
import type { ImageProps } from 'next/image';
import { useState } from 'react';

interface MapImageProps extends Omit<ImageProps, 'onError'> {
  fallbackSrc?: string;
  unoptimized?: boolean;
}

export default function MapImage({ src, alt, fallbackSrc, unoptimized = false, ...props }: MapImageProps) {
  const [error, setError] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  if (error) {
    if (fallbackSrc && !fallbackError) {
      return (
        <Image
          src={fallbackSrc}
          alt={alt}
          unoptimized={unoptimized}
          onError={() => setFallbackError(true)}
          {...props}
        />
      );
    }
    return <div className={`bg-zinc-800 flex items-center justify-center ${props.className || ''}`} style={props.style} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      unoptimized={unoptimized}
      onError={() => setError(true)}
      {...props}
    />
  );
}
