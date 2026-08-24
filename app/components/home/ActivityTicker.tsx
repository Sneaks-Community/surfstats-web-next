import type { CSSProperties } from 'react';
import Link from '@/components/Link';
import { Trophy, Clock } from 'lucide-react';
import MapImage from '@/components/MapImage';
import { formatTime, mapImageUrl } from '@/lib/utils';

export interface TickerRecord {
  steamid: string;
  name: string;
  runtime: number;
  map: string;
}

export interface TickerCompletion {
  steamid: string;
  name: string;
  runtime: number;
  map: string;
  type: string;
  bonus: number | null;
}

interface ActivityTickerProps {
  records: TickerRecord[];
  completions: TickerCompletion[];
  mapImagesUrl: string;
}

/** A single normalized chip's data, tagged with which feed it came from. */
interface TickerItem {
  kind: 'record' | 'completion';
  steamid: string;
  name: string;
  runtime: number;
  map: string;
  bonus: number | null;
}

/**
 * Interleave the two feeds (record, completion, record, …). Both arrive
 * newest-first, so alternating preserves recency without parsing dates and
 * gives an evenly-mixed strip.
 */
function interleave(records: TickerRecord[], completions: TickerCompletion[]): TickerItem[] {
  const items: TickerItem[] = [];
  const max = Math.max(records.length, completions.length);
  for (let i = 0; i < max; i++) {
    if (i < records.length) items.push({ kind: 'record', ...records[i], bonus: null });
    if (i < completions.length) items.push({ kind: 'completion', ...completions[i] });
  }
  return items;
}

function Chip({ item, mapImagesUrl }: { item: TickerItem; mapImagesUrl: string }) {
  const isRecord = item.kind === 'record';
  return (
    <div className="flex items-center gap-2.5 shrink-0 border-l border-border pl-4 pr-5 py-3">
      <MapImage
        src={mapImageUrl(mapImagesUrl, item.map)}
        alt={`${item.map} thumbnail`}
        unoptimized
        width={40}
        height={40}
        className="rounded-md shrink-0"
        referrerPolicy="no-referrer"
      />
      <div className="flex flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          {isRecord ? (
            <Trophy className="h-3.5 w-3.5 text-amber-400 shrink-0" aria-hidden />
          ) : (
            <Clock className="h-3.5 w-3.5 text-blue-400 shrink-0" aria-hidden />
          )}
          <span className="sr-only">{isRecord ? 'Record on' : 'Completion of'}</span>
          <Link
            href={`/maps/${item.map}`}
            className="text-sm font-medium text-text hover:text-primary transition-colors whitespace-nowrap"
          >
            {item.map}
          </Link>
          {item.bonus != null && (
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-1.5 py-0.5 rounded whitespace-nowrap">
              B{item.bonus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-text-muted whitespace-nowrap">
          <Link
            href={`/players/${item.steamid}`}
            className="hover:text-text transition-colors"
          >
            {item.name || 'Unknown'}
          </Link>
          <span aria-hidden>·</span>
          <span className="font-mono text-text">{formatTime(item.runtime)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Latest Activity ticker — a single continuous horizontal marquee that merges
 * the "Latest Records" and "Latest Completions" feeds into one compact strip,
 * replacing the two tall columns that made the front page long.
 *
 * Pure CSS (no client JS): the track holds two identical sequences and slides
 * left by exactly one sequence-width on loop for a seamless scroll (see
 * `.ticker-*` rules in globals.css). It pauses on hover, and collapses to a
 * manually-scrollable strip under `prefers-reduced-motion`.
 */
export default function ActivityTicker({ records, completions, mapImagesUrl }: ActivityTickerProps) {
  const items = interleave(records, completions);
  if (items.length === 0) return null;

  // Keep the on-screen speed roughly constant regardless of item count.
  const duration = Math.max(30, items.length * 4);

  const seq = (hidden: boolean) => (
    <div
      className={`ticker-seq flex items-stretch ${hidden ? 'ticker-dupe' : ''}`}
      aria-hidden={hidden || undefined}
    >
      {items.map((item, i) => (
        <Chip key={`${item.kind}-${item.map}-${item.steamid}-${i}`} item={item} mapImagesUrl={mapImagesUrl} />
      ))}
    </div>
  );

  return (
    <div className="ticker-viewport relative overflow-hidden">
      <div
        className="ticker-track flex w-max"
        style={{ '--ticker-duration': `${duration}s` } as CSSProperties}
      >
        {seq(false)}
        {seq(true)}
      </div>
      {/* Edge fades so chips ease in/out rather than clipping hard at the borders. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-surface to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-surface to-transparent" />
    </div>
  );
}
