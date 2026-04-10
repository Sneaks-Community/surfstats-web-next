import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import { unstable_cache } from 'next/cache';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const QUERY_TIMEOUT_MS = 30000; // 30 seconds - prevents indefinite query hanging

interface BonusRecord extends RowDataPacket {
  steamid: string;
  name: string;
  zonegroup: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface BonusesResponse {
  bonuses: BonusRecord[];
  bonusGroupsList: number[];
  pagination: {
    bonus: number;
    page: number;
    pageSize: number;
    offset: number;
    total: number;
    totalPages: number;
  };
}

// Server-side cache for bonus records
// Cache key includes mapname, bonus, page, and pageSize to create unique entries
const getBonusRecords = unstable_cache(
  async (
    mapname: string,
    bonus: number,
    page: number,
    pageSize: number
  ): Promise<BonusesResponse> => {
    const offset = (page - 1) * pageSize;

    // Create timeout promise to prevent indefinite query hanging
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Query timeout exceeded')), QUERY_TIMEOUT_MS);
    });

    try {
      // Get list of all bonus groups
      const [bonusGroupsRows] = await Promise.race([
        pool.query<RowDataPacket[]>(`
          SELECT DISTINCT zonegroup FROM ck_bonus WHERE mapname = ? ORDER BY zonegroup ASC
        `, [mapname]),
        timeoutPromise
      ]);
      const bonusGroupsList = bonusGroupsRows.map(row => row.zonegroup);

      // Get total count for this bonus group
      const [countRows] = await Promise.race([
        pool.query<RowDataPacket[]>(`
          SELECT COUNT(*) as total FROM ck_bonus WHERE mapname = ? AND zonegroup = ?
        `, [mapname, bonus]),
        timeoutPromise
      ]);
      const totalRecords = countRows[0]?.total || 0;

      // Get bonus records with pagination using window function
      const [bonusRows] = await Promise.race([
        pool.query<BonusRecord[]>(`
          SELECT
            b.steamid, b.name, b.zonegroup, b.runtime, b.date, b.startspeed,
            ROW_NUMBER() OVER (ORDER BY b.runtime ASC) as rank,
            (SELECT MIN(runtime) FROM ck_bonus WHERE mapname = b.mapname AND zonegroup = b.zonegroup) as wr_time
          FROM ck_bonus b
          WHERE b.mapname = ? AND b.zonegroup = ?
          ORDER BY b.runtime ASC
          LIMIT ? OFFSET ?
        `, [mapname, bonus, pageSize, offset]),
        timeoutPromise
      ]);

      logger.debug(`[API] Fetched ${bonusRows.length} bonus records for ${mapname} bonus ${bonus}`);

      return {
        bonuses: bonusRows,
        bonusGroupsList,
        pagination: {
          bonus,
          page,
          pageSize,
          offset,
          total: totalRecords,
          totalPages: Math.ceil(totalRecords / pageSize),
        },
      };
    } catch (error: any) {
      if (error.message === 'Query timeout exceeded') {
        logger.error(`[API] Query timeout for ${mapname} bonus ${bonus} after ${QUERY_TIMEOUT_MS / 1000} seconds`);
        return {
          bonuses: [],
          bonusGroupsList: [],
          pagination: {
            bonus,
            page,
            pageSize,
            offset,
            total: 0,
            totalPages: 0,
          },
        };
      }
      logger.error(`[API] Failed to fetch bonus records for ${mapname}: ${error.message}`);
      throw error;
    }
  },
  [],
  { revalidate: 300 } // Revalidate cache every 5 minutes
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
  const bonus = parseInt(searchParams.get('bonus') || '1', 10);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const data = await getBonusRecords(validMapname, bonus, page, pageSize);
    return NextResponse.json(data);
  } catch (error: any) {
    logger.error(`[API] Failed to fetch bonus records for ${validMapname}: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch bonus records' },
      { status: 500 }
    );
  }
}
