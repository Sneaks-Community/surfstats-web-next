import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveSteamIdParam, apiError, RECORDS_CACHE_CONTROL } from '@/lib/api-utils';
import { getPlayerMapTimesFromCache, getIncompleteMapsFromCache, getPlayerOverviewFromCache } from '@/lib/player-profile-cache';

/**
 * Full list of the player's completed map times + the maps they haven't done.
 * Fetched on demand when the user opens the Times → Map sub-tab (never on the
 * initial server render), so crawlers hitting the player page don't trigger the
 * expensive correlated-rank/anti-join queries.
 *
 * Inherits origin guard, rate limiting, and fail-closed-on-Valkey (503) from
 * `proxy.ts` (matches `/api/:path*`).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ steamid: string }> }
) {
  const { steamid } = await params;
  const validSteamId = resolveSteamIdParam(steamid);
  if (validSteamId instanceof NextResponse) return validSteamId;

  try {
    // One indexed lookup, cached 1h and already warm from the profile page.
    // Without it any bogus numeric id runs the MIN()/GROUP BY derived table, the
    // correlated rank subquery and the anti-join, then caches the empty result.
    if (!(await getPlayerOverviewFromCache(validSteamId))) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 });
    }

    const [records, incomplete] = await Promise.all([
      getPlayerMapTimesFromCache(validSteamId),
      getIncompleteMapsFromCache(validSteamId),
    ]);
    return NextResponse.json({ records, incomplete }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch player map times for ${validSteamId}`, error, 'Failed to fetch player map times');
  }
}
