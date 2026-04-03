import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import logger from '@/lib/logger';

interface LatestCompletion extends RowDataPacket {
  steamid: string;
  name: string;
  map: string;
  runtime: number;
  date: string;
  type: 'map' | 'bonus';
  bonus?: number;
}

// Server-side cache for latest completions
// Cache key includes the combined query result
const getLatestCompletions = async (): Promise<LatestCompletion[]> => {
  try {
    // Optimized approach: Fetch top N from each table separately using indexes,
    // then combine and sort in application code. This avoids full table scans.
    const [mapRows] = await pool.query<RowDataPacket[]>(`
      SELECT 
        pt.steamid,
        pt.name,
        pt.mapname,
        pt.runtimepro as runtime,
        pt.date,
        'map' as type,
        NULL as bonus
      FROM ck_playertimes pt
      ORDER BY pt.date DESC
      LIMIT 25
    `);

    const [bonusRows] = await pool.query<RowDataPacket[]>(`
      SELECT 
        b.steamid,
        b.name,
        b.mapname,
        b.runtime,
        b.date,
        'bonus' as type,
        b.zonegroup as bonus
      FROM ck_bonus b
      ORDER BY b.date DESC
      LIMIT 25
    `);

    // Combine and sort in application code
    const combined = [...mapRows, ...bonusRows] as LatestCompletion[];
    combined.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    const result = combined.slice(0, 10);

    const mapCount = result.filter(r => r.type === 'map').length;
    const bonusCount = result.filter(r => r.type === 'bonus').length;
    logger.debug(`[API Completions] Fetched ${result.length} latest completions (${mapCount} map, ${bonusCount} bonus)`);
    
    return result;
  } catch (error: any) {
    logger.error(`[API Completions] Failed to fetch latest completions: ${error.message}`);
    throw error;
  }
};

export async function GET() {
  try {
    const completions = await getLatestCompletions();
    return NextResponse.json(completions);
  } catch (error: any) {
    logger.error(`[API Completions] GET failed: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch latest completions' },
      { status: 500 }
    );
  }
}
