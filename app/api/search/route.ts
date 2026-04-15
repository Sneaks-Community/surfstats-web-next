import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { searchPlayersFromCache } from '@/lib/player-cache';
import { getAllMapMetadata } from '@/lib/map-cache';
import { sanitizeSearchQuery } from '@/lib/sanitize';
import { getSteamProfilesFromCache } from '@/lib/steam';
import logger from '@/lib/logger';

const MAX_PLAYERS = 3;
const MAX_MAPS = 3;
const MIN_CHARS = 3;
const MAX_CHARS = 50;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';

  // Validate query length
  if (query.length < MIN_CHARS || query.length > MAX_CHARS) {
    return NextResponse.json({ players: [], maps: [] });
  }

  // Sanitize query to prevent XSS
  const sanitizedQuery = sanitizeSearchQuery(query);

  try {
    // Search players using cached function
    const allPlayers = await searchPlayersFromCache(sanitizedQuery);
    const playerResults = allPlayers.slice(0, MAX_PLAYERS);

    // Fetch avatars for players
    const steamIds = playerResults.map(p => p.steamid);
    const avatars = await getSteamProfilesFromCache(steamIds);

    const players = playerResults.map(player => ({
      steamid: player.steamid,
      name: player.name,
      points: player.points,
      avatar: avatars.get(player.steamid)?.avatar || null,
      avatarmedium: avatars.get(player.steamid)?.avatarmedium || null,
    }));

    // Search maps using cached map metadata
    const allMaps = await getAllMapMetadata();
    const queryLower = sanitizedQuery.toLowerCase();
    const maps = Array.from(allMaps.values())
      .filter(map => map.mapname.toLowerCase().includes(queryLower))
      .sort((a, b) => a.mapname.localeCompare(b.mapname))
      .slice(0, MAX_MAPS)
      .map(map => ({ mapname: map.mapname, tier: map.tier }));

    return NextResponse.json({ players, maps });
  } catch (error) {
    logger.error(`[API/search] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Search failed' },
      { status: 500 }
    );
  }
}
