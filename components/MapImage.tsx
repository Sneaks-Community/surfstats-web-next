'use client';

import Image, { ImageProps } from 'next/image';
import { useState } from 'react';

interface MapImageProps extends Omit<ImageProps, 'onError'> {
  fallbackSrc?: string;
}

export default function MapImage({ src, alt, fallbackSrc, ...props }: MapImageProps) {
  const [error, setError] = useState(false);

  if (error) {
    if (fallbackSrc) {
      return <Image src={fallbackSrc} alt={alt} {...props} />;
    }
    return <div className={`bg-zinc-800 flex items-center justify-center ${props.className || ''}`} style={props.style} />;
  }

  return (
    <Image
      src={src}
      alt={alt}
      onError={() => setError(true)}
      {...props}
    />
  );
}
