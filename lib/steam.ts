import 'server-only';
import logger from '@/lib/logger';

/**
 * Steam API interface types
 */
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

/**
 * Fetch player data directly from Steam API
 * This is the core function that makes the actual Steam API call
 * @param steamId64s - Array of SteamID64 values to fetch
 * @returns Array of Steam player data or empty array on error
 */
async function fetchSteamPlayerData(steamId64s: string[]): Promise<SteamPlayer[]> {
  const startTime = Date.now();
  const apiKey = process.env.STEAM_API_KEY;

  if (!apiKey) {
    logger.error('[Steam API] STEAM_API_KEY not configured');
    return [];
  }

  try {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId64s.join(',')}`,
      { next: { revalidate: 86400 } } // Cache for 24 hours
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
      return [];
    }

    const data: SteamWrapperResponse = await response.json();
    const duration = Date.now() - startTime;
    
    // Steam API returns data in { response: { players: [...] } } format
    const players = data.response?.players || [];
    
    logger.debug(`[Steam API] Successfully fetched ${players.length} players in ${duration}ms`);
    
    return players;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorCode = error.code || 'UNKNOWN';
    const errorMessage = error.message || 'Unknown error';
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      logger.error(`[Steam API] Network error - unable to reach Steam API servers (${errorCode})`);
    } else if (error.code === 'ETIMEDOUT') {
      logger.error(`[Steam API] Request timed out after ${duration}ms`);
    } else {
      logger.error(`[Steam API] Error fetching data after ${duration}ms: ${errorMessage}`);
    }
    
    return [];
  }
}

/**
 * Fetch avatar data for a single SteamID using the Steam API directly
 * @param steamId - The SteamID to fetch avatars for
 * @returns Avatar data or null if failed
 */
export async function getSteamAvatars(steamId: string): Promise<{ avatar: string; avatarmedium: string; avatarfull: string } | null> {
  const startTime = Date.now();
  
  try {
    // Convert STEAM_1:0:12345 to SteamID64
    const steamId64 = convertSteamIdTo64(steamId);
    if (!steamId64) {
      logger.warn(`[Steam] Invalid SteamID format: ${steamId}`);
      return null;
    }

    logger.debug(`[Steam] Fetching avatar for ${steamId} (SteamID64: ${steamId64})`);
    
    // Call Steam API directly - no HTTP proxy needed
    const players = await fetchSteamPlayerData([steamId64]);
    
    if (players.length === 0) {
      const duration = Date.now() - startTime;
      logger.warn(`[Steam] No player data found for SteamID ${steamId} (${duration}ms)`);
      return null;
    }

    const player = players[0];
    const duration = Date.now() - startTime;
    logger.debug(`[Steam] Successfully fetched avatar for ${player.personaname || steamId} (${duration}ms)`);
    
    return {
      avatar: player.avatar || '',
      avatarmedium: player.avatarmedium || '',
      avatarfull: player.avatarfull || ''
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Steam] Error fetching avatar for ${steamId} after ${duration}ms: ${errorMessage}`);
    return null;
  }
}

/**
 * Fetch avatar data for multiple SteamIDs using the Steam API directly
 * @param steamIds - Array of SteamIDs to fetch avatars for
 * @returns Map of original SteamID to avatar data
 */
export async function getSteamProfiles(steamIds: string[]): Promise<Map<string, { avatar: string; avatarmedium: string; avatarfull: string }>> {
  const result = new Map<string, { avatar: string; avatarmedium: string; avatarfull: string }>();
  
  if (steamIds.length === 0) {
    return result;
  }

  const startTime = Date.now();
  logger.debug(`[Steam] Fetching profiles for ${steamIds.length} SteamIDs`);
  
  try {
    // Convert all SteamIDs to SteamID64 and map them back
    const steamId64Map = new Map<string, string>();
    const steamId64s: string[] = [];
    
    for (const steamId of steamIds) {
      const steamId64 = convertSteamIdTo64(steamId);
      if (steamId64) {
        steamId64Map.set(steamId64, steamId);
        steamId64s.push(steamId64);
      } else {
        logger.warn(`[Steam] Could not convert SteamID: ${steamId}`);
      }
    }

    if (steamId64s.length === 0) {
      logger.warn('[Steam] No valid SteamID64s to query');
      return result;
    }

    // Call Steam API directly - no HTTP proxy needed
    const players = await fetchSteamPlayerData(steamId64s);
    
    for (const player of players) {
      const originalSteamId = steamId64Map.get(player.steamid);
      if (originalSteamId) {
        result.set(originalSteamId, {
          avatar: player.avatar || '',
          avatarmedium: player.avatarmedium || '',
          avatarfull: player.avatarfull || ''
        });
      }
    }
    
    const duration = Date.now() - startTime;
    logger.debug(`[Steam] Profile fetch complete: ${result.size}/${steamIds.length} profiles retrieved (${duration}ms)`);
    
    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Steam] Failed to fetch profiles after ${duration}ms: ${errorMessage}`);
    return result;
  }
}

/**
 * Convert SteamID2 (STEAM_X:Y:Z) to SteamID64
 * @param steamId - SteamID2 format (e.g., STEAM_1:0:12345)
 * @returns SteamID64 string or null if invalid
 */
export function convertSteamIdTo64(steamId: string): string | null {
  const match = steamId.match(/^STEAM_([0-5]):([0-1]):([0-9]+)$/);
  if (!match) return null;

  const v = BigInt('76561197960265728');
  const z = BigInt(match[3]);
  const y = BigInt(match[2]);

  return (v + z * BigInt(2) + y).toString();
}

/**
 * Convert SteamID2 (STEAM_X:Y:Z) to SteamID3 numeric (Y component in [U:1:Y])
 * SteamID3 numeric = Z * 2 + Y
 * @param steamId - SteamID2 format (e.g., STEAM_1:0:95515509)
 * @returns SteamID3 numeric value or null if invalid
 */
export function convertSteamId2ToSteamId3Numeric(steamId: string): number | null {
  const match = steamId.match(/^STEAM_([0-5]):([0-1]):([0-9]+)$/);
  if (!match) return null;

  const z = parseInt(match[3], 10);
  const y = parseInt(match[2], 10);

  // SteamID3 numeric = Z * 2 + Y
  return z * 2 + y;
}

/**
 * Convert SteamID3 numeric (Y component in [U:1:Y]) to SteamID2 format
 * @param steamId3Numeric - SteamID3 numeric value
 * @returns SteamID2 format string (e.g., STEAM_1:0:95515509)
 */
export function convertSteamId3NumericToSteamId2(steamId3Numeric: number): string {
  const z = Math.floor(steamId3Numeric / 2);
  const y = steamId3Numeric % 2;

  return `STEAM_1:${y}:${z}`;
}

/**
 * Generates a Steam community profile URL from a SteamID
 * @param steamId - Can be either STEAM_1:0:12345 format or already a SteamID64
 * @returns The Steam profile URL or null if the steamId is invalid
 */
export function getSteamProfileUrl(steamId: string): string | null {
  // Check if it's already a SteamID64 (numeric string)
  if (/^\d+$/.test(steamId)) {
    return `https://steamcommunity.com/profiles/${steamId}`;
  }
  
  // Try to convert STEAM_1:0:12345 format to SteamID64
  const steamId64 = convertSteamIdTo64(steamId);
  if (steamId64) {
    return `https://steamcommunity.com/profiles/${steamId64}`;
  }
  
  return null;
}
