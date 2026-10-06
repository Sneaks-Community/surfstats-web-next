'use client';

import Image from 'next/image';
import type { ImageProps } from 'next/image';
import { useState } from 'react';

export default function MapImage({ alt, ...props }: Omit<ImageProps, 'onError'>) {
  const [error, setError] = useState(false);

  if (error) {
    return <div className={`bg-zinc-800 flex items-center justify-center ${props.className || ''}`} style={props.style} />;
  }

  return <Image alt={alt} onError={() => setError(true)} {...props} />;
}
