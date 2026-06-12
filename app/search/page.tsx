import Link from 'next/link';
import { Search as SearchIcon, Map as MapIcon, Users, ChevronRight } from 'lucide-react';
import MapImage from '@/components/MapImage';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import { getTierTextColor } from '@/lib/tierColors';
import { validateSearchQuery, validatePlayerName } from '@/lib/validators';
import { getAllMapMetadataFromCache } from '@/lib/valkey-map-cache';
import { searchPlayersFromCache } from '@/lib/player-cache';
import type { PlayerSearchResult } from '@/lib/player-cache';
import logger from '@/lib/logger';
import type { Metadata } from 'next';
import { getErrorMessage } from '@/lib/errors';

export const metadata: Metadata = {
  title: 'Search',
};

interface MapResult {
  mapname: string;
  tier: number;
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  // Sanitize search query to prevent XSS and injection
  const query = validateSearchQuery(q);
  
  let players: PlayerSearchResult[] = [];
  let maps: MapResult[] = [];
  
  if (query.length >= 2) {
    try {
      // Search players using cached function
      players = await searchPlayersFromCache(query);
      
      // Search maps using cached map metadata (Valkey cache)
      const allMaps = await getAllMapMetadataFromCache();
      const queryLower = query.toLowerCase();
      maps = Array.from(allMaps.values())
        .filter(map => map.mapname.toLowerCase().includes(queryLower))
        .map(map => ({ mapname: map.mapname, tier: map.tier }))
        .sort((a, b) => a.mapname.localeCompare(b.mapname))
        .slice(0, 10);
      
      logger.debug(`[Search] Results for "${query}": ${players.length} players, ${maps.length} maps (cached)`);
    } catch (error: unknown) {
      const err = error as { message?: string; code?: string };
      const errorMessage = getErrorMessage(error);
      logger.error(`[Search] Query failed for "${query}": ${errorMessage}`);
      logger.error(`[Search] Error code: ${err.code || 'N/A'}`);
    }
  }

  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      <div className="text-center space-y-4 py-8">
        <h1 className="text-4xl font-bold text-text">Search</h1>
        <form className="relative max-w-2xl mx-auto">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <SearchIcon className="h-6 w-6 text-text-placeholder" />
          </div>
          <input
            type="text"
            name="q"
            defaultValue={query}
            className="block w-full pl-12 pr-4 py-4 border border-border rounded-xl leading-5 bg-background-secondary text-lg text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-2 focus:ring-border-focus transition-all shadow-lg"
            placeholder="Search for players (name, SteamID) or maps..."
            autoFocus
          />
        </form>
      </div>

      {query.length > 0 && query.length < 2 && (
        <div className="text-center text-text-muted py-8">
          Please enter at least 2 characters to search.
        </div>
      )}

      {query.length >= 2 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Players Results */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-xl font-semibold text-text flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Players
              </h2>
              <span className="text-sm text-text-placeholder">{players.length} results</span>
            </div>
            
            {players.length > 0 ? (
              <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
                {players.map((player) => (
                  <Link 
                    key={player.steamid} 
                    href={`/players/${player.steamid}`}
                    className="flex items-center justify-between p-4 hover:bg-surface-hover/50 transition-colors group"
                  >
                    <div>
                      <div className="font-medium text-primary group-hover:text-primary transition-colors">
                        {validatePlayerName(player.name)}
                      </div>
                      <div className="text-xs text-text-placeholder mt-0.5">{player.steamid}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-sm text-text-muted text-right">
                        <div className="font-medium text-text">{player.points.toLocaleString()}</div>
                        <div className="text-[10px] uppercase tracking-wider">Points</div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-text-placeholder group-hover:text-text-muted transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-placeholder">
                No players found matching {'"'}{query}{'"'}
              </div>
            )}
            
            {players.length === 10 && (
              <div className="text-center">
                <Link href={`/players?q=${encodeURIComponent(query)}`} className="text-sm text-primary hover:text-primary transition-colors underline">
                  View all player results &rarr;
                </Link>
              </div>
            )}
          </div>

          {/* Maps Results */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-xl font-semibold text-text flex items-center gap-2">
                <MapIcon className="h-5 w-5 text-blue-500" />
                Maps
              </h2>
              <span className="text-sm text-text-placeholder">{maps.length} results</span>
            </div>
            
            {maps.length > 0 ? (
              <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
                {maps.map((map) => (
                  <div
                    key={map.mapname}
                    className="flex items-center justify-between p-4 hover:bg-surface-hover/50 transition-colors group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="relative h-12 w-16 rounded overflow-hidden bg-surface-hover flex-shrink-0">
                        <MapImage
                          src={`${mapImagesUrl}${map.mapname}.jpg`}
                          alt={map.mapname}
                          unoptimized
                          fill
                          className="object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <div>
                        <MapLinkWithPreview mapname={map.mapname} className="font-medium text-primary group-hover:text-primary transition-colors">
                          {map.mapname}
                        </MapLinkWithPreview>
                        <div className={`text-xs mt-0.5 ${getTierTextColor(map.tier)}`}>Tier {map.tier}</div>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-text-placeholder group-hover:text-text-muted transition-colors" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-xl p-8 text-center text-text-placeholder">
                No maps found matching {'"'}{query}{'"'}
              </div>
            )}
            
            {maps.length === 10 && (
              <div className="text-center">
                <Link href={`/maps?q=${encodeURIComponent(query)}`} className="text-sm text-primary hover:text-primary transition-colors underline">
                  View all map results &rarr;
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}