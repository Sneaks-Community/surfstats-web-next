import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

interface MapRecord extends RowDataPacket {
  steamid: string;
  name: string;
  runtimepro: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface RecordCounts {
  leaderboardTotal: number;
  bonusesTotal: number;
  stagesTotal: number;
}

interface RecordCountsRow extends RowDataPacket, RecordCounts {}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = sanitizeMapName(decodedMapname);

  if (!validMapname) {
    return NextResponse.json({ error: 'Invalid map name' }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
  );

  const offset = (page - 1) * pageSize;

  try {
    // Get total counts
    const [countsRows] = await pool.query<RecordCountsRow[]>(`
      SELECT 
        (SELECT COUNT(*) FROM ck_playertimes WHERE mapname = ?) as leaderboardTotal,
        (SELECT COUNT(*) FROM ck_bonus WHERE mapname = ?) as bonusesTotal,
        (SELECT COUNT(*) FROM ck_stages WHERE \`map\` = ?) as stagesTotal
    `, [validMapname, validMapname, validMapname]);

    const counts: RecordCounts = {
      leaderboardTotal: countsRows[0]?.leaderboardTotal || 0,
      bonusesTotal: countsRows[0]?.bonusesTotal || 0,
      stagesTotal: countsRows[0]?.stagesTotal || 0,
    };

    // Get WR time
    const [wrTimeRows] = await pool.query<RowDataPacket[]>(`
      SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
    `, [validMapname]);
    const wr_time = wrTimeRows[0]?.wr_time || null;

    // Get paginated leaderboard records using window function
    const [leaderboardRows] = await pool.query<MapRecord[]>(`
      SELECT 
        steamid, name, runtimepro, date, startspeed,
        ROW_NUMBER() OVER (ORDER BY runtimepro ASC) as rank,
        ? as wr_time
      FROM ck_playertimes
      WHERE mapname = ?
      ORDER BY runtimepro ASC
      LIMIT ? OFFSET ?
    `, [wr_time, validMapname, pageSize, offset]);

    logger.debug(`[API] Fetched ${leaderboardRows.length} records for ${validMapname} (page ${page})`);

    return NextResponse.json({
      records: leaderboardRows,
      pagination: {
        page,
        pageSize,
        offset,
        total: counts.leaderboardTotal,
        totalPages: Math.ceil(counts.leaderboardTotal / pageSize),
      },
      wr_time,
    });
  } catch (error: any) {
    logger.error(`[API] Failed to fetch records for ${validMapname}: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch records' },
      { status: 500 }
    );
  }
}
