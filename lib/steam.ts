import 'server-only';
import logger from '@/lib/logger';

export async function getSteamAvatars(steamId: string): Promise<{ avatar: string; avatarmedium: string; avatarfull: string } | null> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    logger.warn('[Steam] STEAM_API_KEY not configured - avatar fetching disabled');
    return null;
  }

  const startTime = Date.now();
  
  try {
    // Convert STEAM_1:0:12345 to SteamID64
    const steamId64 = convertSteamIdTo64(steamId);
    if (!steamId64) {
      logger.warn(`[Steam] Invalid SteamID format: ${steamId}`);
      return null;
    }

    logger.debug(`[Steam] Fetching avatar for ${steamId} (SteamID64: ${steamId64})`);
    
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamId64}`,
      { next: { revalidate: 3600 } } // Cache for 1 hour
    );

    if (!response.ok) {
      const duration = Date.now() - startTime;
      if (response.status === 403) {
        logger.error(`[Steam] API key invalid or forbidden (${response.status}) - check STEAM_API_KEY`);
      } else if (response.status === 429) {
        logger.error(`[Steam] Rate limited by Steam API (${response.status}) - too many requests`);
      } else {
        logger.error(`[Steam] API request failed with status ${response.status} after ${duration}ms`);
      }
      return null;
    }

    const data = await response.json();
    const player = data.response.players[0];
    if (!player) {
      const duration = Date.now() - startTime;
      logger.warn(`[Steam] No player data found for SteamID ${steamId} (${duration}ms)`);
      return null;
    }

    const duration = Date.now() - startTime;
    logger.debug(`[Steam] Successfully fetched avatar for ${player.personaname || steamId} (${duration}ms)`);
    
    return {
      avatar: player.avatar || '',
      avatarmedium: player.avatarmedium || '',
      avatarfull: player.avatarfull || ''
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const errorCode = error.code || 'UNKNOWN';
    const errorMessage = error.message || 'Unknown error';
    
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      logger.error(`[Steam] Network error - unable to reach Steam API servers (${errorCode})`);
    } else if (error.code === 'ETIMEDOUT') {
      logger.error(`[Steam] Request timed out after ${duration}ms`);
    } else {
      logger.error(`[Steam] Error fetching avatar for ${steamId} after ${duration}ms: ${errorMessage}`);
    }
    
    return null;
  }
}

export async function getSteamProfiles(steamIds: string[]): Promise<Map<string, { avatar: string; avatarmedium: string; avatarfull: string }>> {
  const result = new Map<string, { avatar: string; avatarmedium: string; avatarfull: string }>();
  
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    logger.warn('[Steam] STEAM_API_KEY not configured - profile fetching disabled');
    return result;
  }
  
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

    // Steam API allows up to 100 steamids per request
    const chunks: string[][] = [];
    for (let i = 0; i < steamId64s.length; i += 100) {
      chunks.push(steamId64s.slice(i, i + 100));
    }

    logger.debug(`[Steam] Processing ${chunks.length} API chunk(s)`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = Date.now();
      
      try {
        const response = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${chunk.join(',')}`,
          { next: { revalidate: 3600 } } // Cache for 1 hour
        );

        if (!response.ok) {
          const chunkDuration = Date.now() - chunkStart;
          if (response.status === 403) {
            logger.error(`[Steam] API key invalid or forbidden (${response.status}) in chunk ${i + 1}/${chunks.length} - check STEAM_API_KEY`);
          } else if (response.status === 429) {
            logger.error(`[Steam] Rate limited by Steam API (${response.status}) in chunk ${i + 1}/${chunks.length}`);
          } else {
            logger.error(`[Steam] API request failed with status ${response.status} in chunk ${i + 1}/${chunks.length} (${chunkDuration}ms)`);
          }
          continue;
        }

        const data = await response.json();
        const players = data.response.players || [];
        
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
        
        const chunkDuration = Date.now() - chunkStart;
        logger.debug(`[Steam] Chunk ${i + 1}/${chunks.length} completed: ${players.length} profiles (${chunkDuration}ms)`);
      } catch (chunkError: any) {
        const chunkDuration = Date.now() - chunkStart;
        logger.error(`[Steam] Error in chunk ${i + 1}/${chunks.length} after ${chunkDuration}ms: ${chunkError.message || 'Unknown error'}`);
        // Continue with next chunk
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