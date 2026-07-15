'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import MapImage from './MapImage';
import { useMapImagesUrl } from '@/lib/MapImagesUrlContext';
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

  // Calculate thumbnail position to stay within viewport
  const updateThumbnailPosition = useCallback((x: number, y: number) => {
    const thumbnailWidth = 160;
    const thumbnailHeight = 120;
    const offset = 15;
    const padding = 10;

    // Determine horizontal position
    if (x + offset + thumbnailWidth + padding > window.innerWidth) {
      setThumbnailPosition('left');
    } else {
      setThumbnailPosition('right');
    }

    // Determine vertical position
    if (y + offset + thumbnailHeight + padding > window.innerHeight) {
      setThumbnailVerticalPosition('above');
    } else {
      setThumbnailVerticalPosition('below');
    }

    setPosition({ x, y });
  }, []);

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    // Start tracking position
    updateThumbnailPosition(e.clientX, e.clientY);
    
    // Set a 200ms delay before showing the thumbnail
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
      // Trigger fade-in after a small delay to ensure the element is rendered
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
    // Clear the timeout if mouse leaves before delay completes
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    // Fade out
    setIsFadingIn(false);
    // Wait for fade-out transition before removing from DOM
    setTimeout(() => {
      setIsVisible(false);
    }, 150);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Calculate actual position for the thumbnail
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