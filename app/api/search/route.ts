import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { searchPlayersFromCache } from '@/lib/player-cache';
import { searchMaps } from '@/lib/map-cache';
import { validateSearchQuery } from '@/lib/validators';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { apiError } from '@/lib/api-utils';
import { MIN_SEARCH_LENGTH } from '@/lib/utils';

const MAX_PLAYERS = 3;
const MAX_MAPS = 3;
const MAX_CHARS = 50;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q') || '';

  // Bound the *sanitized* length: raw junk like `<<<<` sanitizes to '', which would reach the
  // cache as `LIKE '%%'`, a full ck_playerrank scan.
  const sanitizedQuery = validateSearchQuery(query);
  if (sanitizedQuery.length < MIN_SEARCH_LENGTH || sanitizedQuery.length > MAX_CHARS) {
    return NextResponse.json({ players: [], maps: [] });
  }

  try {
    const allPlayers = await searchPlayersFromCache(sanitizedQuery);
    const playerResults = allPlayers.slice(0, MAX_PLAYERS);

    const steamIds = playerResults.map(p => p.steamid);
    const avatars = await getSteamProfilesFromCache(steamIds);

    const players = playerResults.map(player => ({
      steamid: player.steamid,
      name: player.name,
      points: player.points,
      avatar: avatars.get(player.steamid)?.avatar || null,
      avatarmedium: avatars.get(player.steamid)?.avatarmedium || null,
    }));

    const maps = await searchMaps(sanitizedQuery, MAX_MAPS);

    return NextResponse.json({ players, maps });
  } catch (error) {
    return apiError('[API/search] Error', error, 'Search failed');
  }
}
