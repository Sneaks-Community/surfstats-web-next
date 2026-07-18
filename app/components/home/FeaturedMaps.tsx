import { Mountain } from 'lucide-react';
import MapImage from '@/components/MapImage';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import { getTierColor } from '@/lib/tierColors';
import { mapImageUrl } from '@/lib/utils';

export interface FeaturedMapEntry {
  mapname: string;
  tier: number;
  completions: number;
}

/**
 * Visual showcase of maps to play (most-completed, i.e. community favourites).
 * Thumbnail grid with tier badges + completion counts — shows off content and
 * gives newcomers an obvious place to start.
 */
export default function FeaturedMaps({
  maps,
  mapImagesUrl,
}: {
  maps: FeaturedMapEntry[];
  mapImagesUrl: string;
}) {
  if (maps.length === 0) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 flex-1 auto-rows-fr">
      {maps.map((m) => (
        <div
          key={m.mapname}
          className="group flex flex-col rounded-lg overflow-hidden border border-border bg-surface-hover/30 hover:border-border-hover transition-colors"
        >
          <div className="relative flex-1 min-h-24 overflow-hidden">
            <MapImage
              src={mapImageUrl(mapImagesUrl, m.mapname)}
              alt={`${m.mapname} thumbnail`}
              unoptimized
              fill
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              referrerPolicy="no-referrer"
            />
            {/* Solid dark chip (with backdrop-blur) instead of the translucent
                TierBadge so the tier stays legible over bright map skies — same
                treatment the /maps grid uses. */}
            <div className="absolute top-2 left-2">
              <span
                className={`flex items-center gap-1 rounded-md bg-black/60 backdrop-blur-sm px-2 py-1 text-xs font-bold uppercase tracking-wider ring-1 ring-white/10 ${getTierColor(m.tier).text}`}
              >
                <Mountain className="h-3 w-3" />
                T{m.tier}
              </span>
            </div>
          </div>
          <div className="p-2.5">
            <MapLinkWithPreview mapname={m.mapname}>{m.mapname}</MapLinkWithPreview>
            <div className="text-xs text-text-muted mt-1 tabular-nums">
              {m.completions.toLocaleString()} completions
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
