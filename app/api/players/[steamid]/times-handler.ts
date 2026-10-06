import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveSteamIdParam, apiError, RECORDS_CACHE_CONTROL } from '@/lib/api-utils';
import { getPlayerOverviewFromCache } from '@/lib/player-profile-cache';

/** GET for one Times sub-tab: finished records plus not-yet-done ones, fetched only when it opens.
 * Origin guard, rate limit and fail-closed Valkey (503) come from `proxy.ts`. */
export function playerTimesHandler<R, I>(
  section: 'map' | 'bonus' | 'stage',
  getRecords: (steamid: string) => Promise<R[]>,
  getIncomplete: (steamid: string) => Promise<I[]>
) {
  return async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ steamid: string }> }
  ) {
    const { steamid } = await params;
    const validSteamId = resolveSteamIdParam(steamid);
    if (validSteamId instanceof NextResponse) return validSteamId;

    try {
      // Indexed lookup, cached 1h and warm from the profile page, so a bogus id can't run the
      // MIN()/GROUP BY, correlated rank subquery and anti-join, then cache the empty result.
      if (!(await getPlayerOverviewFromCache(validSteamId))) {
        return NextResponse.json({ error: 'Player not found' }, { status: 404 });
      }

      const [records, incomplete] = await Promise.all([
        getRecords(validSteamId),
        getIncomplete(validSteamId),
      ]);
      return NextResponse.json({ records, incomplete }, {
        headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
      });
    } catch (error: unknown) {
      return apiError(
        `[API] Failed to fetch player ${section} times for ${validSteamId}`,
        error,
        `Failed to fetch player ${section} times`
      );
    }
  };
}
