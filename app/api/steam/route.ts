import { NextRequest, NextResponse } from 'next/server';
import { getSteamProfiles } from '@/lib/steam';
import { sanitizeSteamId } from '@/lib/sanitize';
import logger from '@/lib/logger';

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

interface SteamWrapperResponse {
  response?: {
    players: SteamPlayer[];
  };
}

/**
 * Validate that a string is a valid SteamID64 (17-digit numeric string)
 */
function isValidSteamId64(steamId: string): boolean {
  return /^\d{17}$/.test(steamId);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const steamIdsParam = searchParams.get('steamids');

  if (!steamIdsParam) {
    return NextResponse.json({ error: 'Steam IDs are required' }, { status: 400 });
  }

  // Parse and validate Steam IDs
  const rawIds = steamIdsParam.split(',').map(id => id.trim()).filter(id => id.length > 0);
  
  if (rawIds.length === 0) {
    return NextResponse.json({ error: 'At least one valid Steam ID is required' }, { status: 400 });
  }

  // Validate each ID is a proper SteamID64 format
  const validSteamIds: string[] = [];
  const invalidIds: string[] = [];

  for (const rawId of rawIds) {
    // First try to sanitize (handles STEAM_1:0:12345 format)
    const sanitized = sanitizeSteamId(rawId);
    
    if (sanitized) {
      // Check if it's already SteamID64 format or was converted
      if (isValidSteamId64(sanitized)) {
        validSteamIds.push(sanitized);
      } else {
        invalidIds.push(rawId);
      }
    } else if (isValidSteamId64(rawId)) {
      // Already in SteamID64 format
      validSteamIds.push(rawId);
    } else {
      invalidIds.push(rawId);
    }
  }

  if (validSteamIds.length === 0) {
    return NextResponse.json(
      { error: `All provided Steam IDs are invalid: ${invalidIds.join(', ')}` },
      { status: 400 }
    );
  }

  if (invalidIds.length > 0) {
    logger.warn(`[Steam API] Invalid Steam IDs ignored: ${invalidIds.join(', ')}`);
  }

  const startTime = Date.now();

  try {
    // Use the shared utility to fetch Steam profiles directly
    // This avoids the internal HTTP round-trip
    const avatarsMap = await getSteamProfiles(validSteamIds);
    
    // Convert Map to array format expected by the API
    const players: SteamPlayer[] = [];
    for (const [steamid, avatarData] of avatarsMap) {
      players.push({
        steamid,
        personaname: '', // Not available from avatar-only fetch
        profileurl: `https://steamcommunity.com/profiles/${steamid}`,
        avatar: avatarData.avatar,
        avatarmedium: avatarData.avatarmedium,
        avatarfull: avatarData.avatarfull,
        personastate: 0,
        communityvisibilitystate: 3,
        profilestate: 1,
        lastlogoff: 0,
        commentpermission: 'unknown'
      });
    }

    const duration = Date.now() - startTime;
    logger.debug(`[Steam API] Successfully fetched ${players.length} players in ${duration}ms`);
    
    return NextResponse.json({ players });
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error(`[Steam API] Error fetching data after ${duration}ms: ${error.message}`);
    
    return NextResponse.json({ error: 'Failed to fetch Steam data' }, { status: 500 });
  }
}
