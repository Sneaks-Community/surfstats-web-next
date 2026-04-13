import { NextRequest, NextResponse } from 'next/server';
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

interface SteamAPIResponse {
  players: SteamPlayer[];
}

interface SteamWrapperResponse {
  response?: SteamAPIResponse;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const steamIds = searchParams.get('steamids');

  if (!steamIds) {
    return NextResponse.json({ error: 'Steam IDs are required' }, { status: 400 });
  }

  const apiKey = process.env.STEAM_API_KEY;

  if (!apiKey) {
    logger.error('[Steam API] STEAM_API_KEY not configured');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const startTime = Date.now();

  try {
    const response = await fetch(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamIds}`,
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
      return NextResponse.json({ error: 'Failed to fetch Steam data' }, { status: response.status });
    }

    const data: SteamWrapperResponse = await response.json();
    const duration = Date.now() - startTime;
    
    // Steam API returns data in { response: { players: [...] } } format
    const players = data.response?.players || [];
    
    logger.debug(`[Steam API] Successfully fetched ${players.length} players in ${duration}ms`);
    
    return NextResponse.json({ players });
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
    
    return NextResponse.json({ error: 'Failed to fetch Steam data' }, { status: 500 });
  }
}
