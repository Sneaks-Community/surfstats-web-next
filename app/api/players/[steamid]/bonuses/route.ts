import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveSteamIdParam, apiError, RECORDS_CACHE_CONTROL } from '@/lib/api-utils';
import { getPlayerBonusTimesFromCache, getIncompleteBonusesFromCache } from '@/lib/player-profile-cache';

/**
 * Full list of the player's completed bonus times + the bonuses they haven't
 * done. Fetched on demand when the user opens the Times → Bonus sub-tab (never
 * on the initial server render).
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
    const [records, incomplete] = await Promise.all([
      getPlayerBonusTimesFromCache(validSteamId),
      getIncompleteBonusesFromCache(validSteamId),
    ]);
    return NextResponse.json({ records, incomplete }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch player bonus times for ${validSteamId}`, error, 'Failed to fetch player bonus times');
  }
}
