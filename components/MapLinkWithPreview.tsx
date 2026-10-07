'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import Link from '@/components/Link';
import { createPortal } from 'react-dom';
import MapImage from './MapImage';
import { useMapImagesUrl } from '@/lib/ClientConfigContext';
import { mapImageUrl } from '@/lib/utils';

interface MapLinkWithPreviewProps {
  mapname: string;
  children?: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

interface Position {
  x: number;
  y: number;
}

export default function MapLinkWithPreview({
  mapname,
  children,
  className = 'text-primary hover:underline font-medium',
  onClick
}: MapLinkWithPreviewProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isFadingIn, setIsFadingIn] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [thumbnailPosition, setThumbnailPosition] = useState<'right' | 'left'>('right');
  const [thumbnailVerticalPosition, setThumbnailVerticalPosition] = useState<'below' | 'above'>('below');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mapImagesUrl = useMapImagesUrl();

  // Flip the thumbnail left/above when it would overflow the viewport.
  const updateThumbnailPosition = useCallback((x: number, y: number) => {
    const thumbnailWidth = 160;
    const thumbnailHeight = 120;
    const offset = 15;
    const padding = 10;

    if (x + offset + thumbnailWidth + padding > window.innerWidth) {
      setThumbnailPosition('left');
    } else {
      setThumbnailPosition('right');
    }

    if (y + offset + thumbnailHeight + padding > window.innerHeight) {
      setThumbnailVerticalPosition('above');
    } else {
      setThumbnailVerticalPosition('below');
    }

    setPosition({ x, y });
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    updateThumbnailPosition(e.clientX, e.clientY);
    
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      // Next frame, so it renders at opacity 0 first and the fade transition runs.
      requestAnimationFrame(() => {
        setIsFadingIn(true);
      });
    }, 200);
  }, [updateThumbnailPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isVisible) {
      updateThumbnailPosition(e.clientX, e.clientY);
    }
  }, [isVisible, updateThumbnailPosition]);

  const handleMouseLeave = useCallback(() => {
    // Cancel the show delay if it hasn't fired yet.
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    // The hide delay shares the ref, so the unmount cleanup clears whichever timer is pending.
    setIsFadingIn(false);
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      timeoutRef.current = null;
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const thumbnailStyle: React.CSSProperties = {
    position: 'fixed',
    pointerEvents: 'none',
    zIndex: 9999,
    width: '160px',
    height: '120px',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.5)',
    border: '2px solid rgba(16, 185, 129, 0.3)',
    opacity: isFadingIn ? 1 : 0,
    transition: 'opacity 150ms ease-in-out',
    transform: thumbnailPosition === 'right' 
      ? thumbnailVerticalPosition === 'below'
        ? `translate(${position.x + 15}px, ${position.y + 15}px)`
        : `translate(${position.x + 15}px, ${position.y - 15 - 120}px)`
      : thumbnailVerticalPosition === 'below'
        ? `translate(${position.x - 15 - 160}px, ${position.y + 15}px)`
        : `translate(${position.x - 15 - 160}px, ${position.y - 15 - 120}px)`,
  };

  const thumbnail = isVisible && typeof document !== 'undefined' ? createPortal(
    <div style={thumbnailStyle}>
      <MapImage
        src={mapImageUrl(mapImagesUrl, mapname)}
        alt={mapname}
        unoptimized
        fill
        className="object-cover"
        referrerPolicy="no-referrer"
      />
    </div>,
    document.body
  ) : null;

  return (
    <>
      <Link
        href={`/maps/${mapname}`}
        className={className}
        onMouseEnter={handleMouseEnter}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={onClick}
      >
        {children || mapname}
      </Link>
      {thumbnail}
    </>
  );
}