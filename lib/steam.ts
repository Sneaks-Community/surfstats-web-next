import 'server-only';
import logger from '@/lib/logger';

/**
 * Get the base URL for internal API calls
 * During build time, returns null to skip API calls
 * At runtime, returns the full site URL
 */
function getBaseUrl(): string | null {
  // NEXT_PUBLIC_SITE_URL is set at build time, so it's available during build
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  
  // At runtime, construct from available environment variables
  const host = process.env.SITE_URL 
    ? `https://${process.env.SITE_URL}`
    : process.env.HOSTNAME 
      ? `http://${process.env.HOSTNAME}:${process.env.PORT || 3000}`
      : null;
  
  return host;
}

/**
 * Fetch avatar data for a single SteamID using the server-side proxy
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
    
    // Use server-side proxy to keep API key on server
    const baseUrl = getBaseUrl();
    
    // During build time, skip the proxy and return null
    // The proxy is only needed at runtime to keep API key on server
    if (!baseUrl) {
      logger.debug('[Steam] Skipping avatar fetch (build time or no base URL)');
      return null;
    }
    
    const response = await fetch(`${baseUrl}/api/steam?steamids=${steamId64}`, {
      next: { revalidate: 86400 } // Cache for 24 hours
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;
      logger.error(`[Steam] Proxy request failed with status ${response.status} after ${duration}ms`);
      return null;
    }

    const data = await response.json();
    const player = data.players?.[0];
    
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
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Steam] Error fetching avatar for ${steamId} after ${duration}ms: ${errorMessage}`);
    return null;
  }
}

/**
 * Fetch avatar data for multiple SteamIDs using the server-side proxy
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

    // Use server-side proxy to keep API key on server
    const baseUrl = getBaseUrl();
    
    // During build time, skip the proxy and return empty result
    // The proxy is only needed at runtime to keep API key on server
    if (!baseUrl) {
      logger.debug('[Steam] Skipping profile fetch (build time or no base URL)');
      return result;
    }
    
    const response = await fetch(
      `${baseUrl}/api/steam?steamids=${steamId64s.join(',')}`,
      { next: { revalidate: 86400 } } // Cache for 24 hours
    );

    if (!response.ok) {
      const duration = Date.now() - startTime;
      logger.error(`[Steam] Proxy request failed with status ${response.status} after ${duration}ms`);
      return result;
    }

    const data = await response.json();
    const players = data.players || [];
    
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
