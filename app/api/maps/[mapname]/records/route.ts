import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { NextRequest } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import { unstable_cache } from 'next/cache';
import { withTimeout } from '@/lib/timeout';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const QUERY_TIMEOUT_MS = 30000; // 30 seconds - prevents indefinite query hanging

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

// Cached function to fetch record counts and WR time
const getRecordCountsAndWR = unstable_cache(
  async (mapname: string): Promise<{ counts: RecordCounts; wr_time: number | null }> => {
    const validMapname = sanitizeMapName(mapname);

    try {
      // Get total counts
      const [countsRows] = await withTimeout(
        pool.query<RecordCountsRow[]>(`
          SELECT
            (SELECT COUNT(*) FROM ck_playertimes WHERE mapname = ?) as leaderboardTotal,
            (SELECT COUNT(*) FROM ck_bonus WHERE mapname = ?) as bonusesTotal,
            (SELECT COUNT(*) FROM ck_stages WHERE \`map\` = ?) as stagesTotal
        `, [validMapname, validMapname, validMapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      const counts: RecordCounts = {
        leaderboardTotal: countsRows[0]?.leaderboardTotal || 0,
        bonusesTotal: countsRows[0]?.bonusesTotal || 0,
        stagesTotal: countsRows[0]?.stagesTotal || 0,
      };

      // Get WR time
      const [wrTimeRows] = await withTimeout(
        pool.query<RowDataPacket[]>(`
          SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
        `, [validMapname]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );
      const wr_time = wrTimeRows[0]?.wr_time || null;

      return { counts, wr_time };
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message === 'Query timeout exceeded') {
        logger.error(`[API] Query timeout for ${validMapname} after ${QUERY_TIMEOUT_MS / 1000} seconds`);
        return { counts: { leaderboardTotal: 0, bonusesTotal: 0, stagesTotal: 0 }, wr_time: null };
      }
      throw error;
    }
  },
  [],
  { revalidate: 300 }
);

// Cached function to fetch paginated leaderboard records
// Accepts wr_time as optional parameter to avoid duplicate queries when already fetched
const getLeaderboardRecords = unstable_cache(
  async (
    mapname: string,
    page: number,
    pageSize: number,
    wr_time: number | null = null
  ): Promise<{ records: MapRecord[]; wr_time: number | null }> => {
    const validMapname = sanitizeMapName(mapname);
    const offset = (page - 1) * pageSize;

    try {
      // Get WR time if not already provided (avoids duplicate query)
      let localWrTime = wr_time;
      if (localWrTime === null) {
        const [wrTimeRows] = await withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT MIN(runtimepro) as wr_time FROM ck_playertimes WHERE mapname = ?
          `, [validMapname]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        );
        localWrTime = wrTimeRows[0]?.wr_time || null;
      }

      // Get paginated leaderboard records using window function
      const [leaderboardRows] = await withTimeout(
        pool.query<MapRecord[]>(`
          SELECT
            steamid, name, runtimepro, date, startspeed,
            ROW_NUMBER() OVER (ORDER BY runtimepro ASC) as rank,
            ? as wr_time
          FROM ck_playertimes
          WHERE mapname = ?
          ORDER BY runtimepro ASC
          LIMIT ? OFFSET ?
        `, [localWrTime, validMapname, pageSize, offset]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      logger.debug(`[API] Fetched ${leaderboardRows.length} records for ${validMapname} (page ${page})`);

      return { records: leaderboardRows, wr_time: localWrTime };
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message === 'Query timeout exceeded') {
        logger.error(`[API] Query timeout for ${validMapname} page ${page} after ${QUERY_TIMEOUT_MS / 1000} seconds`);
        return { records: [], wr_time: null };
      }
      throw error;
    }
  },
  [],
  { revalidate: 300 }
);

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

  try {
    // Fetch counts and WR time
    const { counts, wr_time } = await getRecordCountsAndWR(validMapname);

    // Fetch paginated records, passing wr_time to avoid duplicate query
    const { records } = await getLeaderboardRecords(validMapname, page, pageSize, wr_time);

    return NextResponse.json({
      records,
      pagination: {
        page,
        pageSize,
        offset: (page - 1) * pageSize,
        total: counts.leaderboardTotal,
        totalPages: Math.ceil(counts.leaderboardTotal / pageSize),
      },
      wr_time,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[API] Failed to fetch records for ${validMapname}: ${err.message || 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Failed to fetch records' },
      { status: 500 }
    );
  }
}
