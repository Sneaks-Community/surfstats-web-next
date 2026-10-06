import 'server-only';
import logger from '@/lib/logger';
import { cacheGetMany, cacheSetMany } from './valkey-cache';
import { getErrorMessage } from './errors';

interface SteamPlayer {
  steamid: string;
  personaname: string;
  profileurl: string;
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
  personastate: number;
  communityvisibilitystate: number;
  profilestate: number;
  lastlogoff: number;
  commentpermission: string;
}

interface SteamAPIResponse {
  players: SteamPlayer[];
}

interface SteamWrapperResponse {
  response?: SteamAPIResponse;
}

export interface SteamAvatarSet {
  avatar: string;
  avatarmedium: string;
  avatarfull: string;
}

/** Steam's documented cap for `GetPlayerSummaries`; more IDs are silently dropped. */
const STEAM_IDS_PER_REQUEST = 100;
const STEAM_AVATAR_TTL = 86400; // 1 day: players change avatars often

function steamAvatarKey(steamId: string): string {
  return `surfstats:steam:avatar:${steamId}`;
}
/** Cached for IDs Steam omits (deleted accounts), so they are not re-asked every render. */
const NO_AVATAR: SteamAvatarSet = { avatar: '', avatarmedium: '', avatarfull: '' };

/** Strips the API key before logging: some fetch failures put the request URL, key included,
 * in the error message, which would log a live credential. */
function redactApiKey(message: string): string {
  return message.replace(/([?&]key=)[^&\s]+/gi, '$1***');
}

/** One GetPlayerSummaries call for SteamID64s; null when Steam failed or no key is set. */
async function fetchSteamPlayerData(steamId64s: string[]): Promise<SteamPlayer[] | null> {
  const startTime = Date.now();
  const apiKey = process.env.STEAM_API_KEY;

  if (!apiKey) {
    logger.error('[Steam API] STEAM_API_KEY not configured');
    return null;
  }

  if (steamId64s.length > STEAM_IDS_PER_REQUEST) {
    logger.error(`[Steam API] Refusing to request ${steamId64s.length} IDs in one call (max ${STEAM_IDS_PER_REQUEST}); caller must chunk`);
    return null;
  }

  try {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId64s.join(',')}`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      const duration = Date.now() - startTime;
      if (response.status === 403) {
        logger.error(`[Steam API] API key invalid or forbidden (${response.status}) - check STEAM_API_KEY`);
      } else if (response.status === 429) {
        logger.error(`[Steam API] Rate limited by Steam API (${response.status}) - too many requests`);
      } else {
        logger.error(`[Steam API] API request failed with status ${response.status} after ${duration}ms`);
      }
      return null;
    }

    const data: SteamWrapperResponse = await response.json();
    const duration = Date.now() - startTime;
    
    const players = data.response?.players || [];
    
    logger.debug(`[Steam API] Successfully fetched ${players.length} players in ${duration}ms`);
    
    return players;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const err = error as { code?: string; message?: string };
    const errorCode = err.code || 'UNKNOWN';
    const errorMessage = redactApiKey(getErrorMessage(error));

    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
      logger.error(`[Steam API] Network error - unable to reach Steam API servers (${errorCode})`);
    } else if (err.code === 'ETIMEDOUT') {
      logger.error(`[Steam API] Request timed out after ${duration}ms`);
    } else {
      logger.error(`[Steam API] Error fetching data after ${duration}ms: ${errorMessage}`);
    }
    
    return null;
  }
}

/** Avatars for SteamID2s, from cache then Steam; keyed by the caller's original SteamID. */
export async function getSteamProfilesFromCache(steamIds: string[]): Promise<Map<string, SteamAvatarSet>> {
  const result = new Map<string, SteamAvatarSet>();
  
  if (steamIds.length === 0) {
    return result;
  }

  const startTime = Date.now();
  logger.debug(`[Steam] Fetching profiles for ${steamIds.length} SteamIDs`);
  
  try {
    // One round trip for all SteamIDs, not one per ID.
    const cached = await cacheGetMany<SteamAvatarSet>(steamIds.map(steamAvatarKey));

    const uncachedSteamIds: string[] = [];
    steamIds.forEach((steamId, i) => {
      const hit = cached[i];
      if (hit) {
        result.set(steamId, hit);
      } else {
        uncachedSteamIds.push(steamId);
      }
    });

    if (uncachedSteamIds.length > 0) {
      const uncachedSteamId64s: string[] = [];
      const uncachedSteamId64Map = new Map<string, string>();

      for (const steamId of uncachedSteamIds) {
        const steamId64 = convertSteamIdTo64(steamId);
        if (steamId64) {
          uncachedSteamId64Map.set(steamId64, steamId);
          uncachedSteamId64s.push(steamId64);
        } else {
          logger.warn(`[Steam] Could not convert SteamID: ${steamId}`);
        }
      }

      if (uncachedSteamId64s.length === 0) {
        logger.warn('[Steam] No valid SteamID64s to query');
        return result;
      }

      // Chunk here rather than trusting every caller to stay under the cap.
      const chunks: string[][] = [];
      for (let i = 0; i < uncachedSteamId64s.length; i += STEAM_IDS_PER_REQUEST) {
        chunks.push(uncachedSteamId64s.slice(i, i + STEAM_IDS_PER_REQUEST));
      }

      const answers = await Promise.all(chunks.map(fetchSteamPlayerData));
      const players = answers.flatMap((answer) => answer ?? []);

      const toCache: Array<{ key: string; value: SteamAvatarSet }> = [];
      for (const player of players) {
        const originalSteamId = uncachedSteamId64Map.get(player.steamid);
        if (originalSteamId) {
          const avatarData = {
            avatar: player.avatar || '',
            avatarmedium: player.avatarmedium || '',
            avatarfull: player.avatarfull || ''
          };
          result.set(originalSteamId, avatarData);
          toCache.push({ key: steamAvatarKey(originalSteamId), value: avatarData });
        }
      }

      // Only answered chunks: a failed call proves nothing about its IDs.
      const misses = chunks
        .filter((_, i) => answers[i] !== null)
        .flat()
        .flatMap((id64) => {
          const steamId = uncachedSteamId64Map.get(id64);
          return steamId && !result.has(steamId) ? [{ key: steamAvatarKey(steamId), value: NO_AVATAR }] : [];
        });

      // One pipelined round trip, like the read.
      await cacheSetMany([...toCache, ...misses], STEAM_AVATAR_TTL);
    }

    const duration = Date.now() - startTime;
    logger.debug(`[Steam] Profile fetch complete: ${result.size}/${steamIds.length} profiles retrieved (${duration}ms)`);
    
    return result;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = getErrorMessage(error);
    logger.error(`[Steam] Failed to fetch profiles after ${duration}ms: ${errorMessage}`);
    return result;
  }
}

/** SteamID2 (`STEAM_X:Y:Z`) to SteamID64; null if invalid. */
export function convertSteamIdTo64(steamId: string): string | null {
  const match = steamId.match(/^STEAM_([0-5]):([0-1]):([0-9]+)$/);
  if (!match) return null;

  const v = BigInt('76561197960265728');
  const z = BigInt(match[3]);
  const y = BigInt(match[2]);

  return (v + z * BigInt(2) + y).toString();
}

/** SteamID2 to the numeric part of SteamID3 `[U:1:N]`; null if invalid. */
export function convertSteamId2ToSteamId3Numeric(steamId: string): number | null {
  const match = steamId.match(/^STEAM_([0-5]):([0-1]):([0-9]+)$/);
  if (!match) return null;

  const z = parseInt(match[3], 10);
  const y = parseInt(match[2], 10);

  return z * 2 + y;
}

/** Accepts SteamID2 or SteamID64; null if invalid. */
export function getSteamProfileUrl(steamId: string): string | null {
  if (/^\d+$/.test(steamId)) {
    return `https://steamcommunity.com/profiles/${steamId}`;
  }
  
  const steamId64 = convertSteamIdTo64(steamId);
  if (steamId64) {
    return `https://steamcommunity.com/profiles/${steamId64}`;
  }
  
  return null;
}
