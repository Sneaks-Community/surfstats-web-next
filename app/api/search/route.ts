import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { searchPlayersFromCache } from '@/lib/player-cache';
import { getAllMapMetadataFromCache } from '@/lib/map-cache';
import { validateSearchQuery } from '@/lib/validators';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { apiError } from '@/lib/api-utils';

const MAX_PLAYERS = 3;
const MAX_MAPS = 3;
const MIN_CHARS = 3;
const MAX_CHARS = 50;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';

  // Sanitize first, then bound the *sanitized* length. Checking the raw input
  // let junk like `<<<<` clear MIN_CHARS and sanitize down to '', which reached
  // the cache as `LIKE '%%'` — a full scan of ck_playerrank.
  const sanitizedQuery = validateSearchQuery(query);
  if (sanitizedQuery.length < MIN_CHARS || sanitizedQuery.length > MAX_CHARS) {
    return NextResponse.json({ players: [], maps: [] });
  }

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
    const allMaps = await getAllMapMetadataFromCache();
    const queryLower = sanitizedQuery.toLowerCase();
    const maps = Array.from(allMaps.values())
      .filter(map => map.mapname.toLowerCase().includes(queryLower))
      .sort((a, b) => a.mapname.localeCompare(b.mapname))
      .slice(0, MAX_MAPS)
      .map(map => ({ mapname: map.mapname, tier: map.tier }));

    return NextResponse.json({ players, maps });
  } catch (error) {
    return apiError('[API/search] Error', error, 'Search failed');
  }
}
