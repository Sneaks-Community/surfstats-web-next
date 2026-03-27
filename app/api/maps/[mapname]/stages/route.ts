import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import { unstable_cache } from 'next/cache';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

interface StageRecord extends RowDataPacket {
  steamid: string;
  name: string;
  stage: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface StagesResponse {
  stages: StageRecord[];
  stagesList: number[];
  pagination: {
    stage: number;
    page: number;
    pageSize: number;
    offset: number;
    total: number;
    totalPages: number;
  };
}

// Server-side cache for stage records
// Cache key includes mapname, stage, page, and pageSize to create unique entries
const getStageRecords = unstable_cache(
  async (
    mapname: string,
    stage: number,
    page: number,
    pageSize: number
  ): Promise<StagesResponse> => {
    const offset = (page - 1) * pageSize;

    try {
      // Get list of all stages
      const [stagesListRows] = await pool.query<RowDataPacket[]>(`
        SELECT DISTINCT stage FROM ck_stages WHERE \`map\` = ? ORDER BY stage ASC
      `, [mapname]);
      const stagesList = stagesListRows.map(row => row.stage);

      // Get total count for this stage
      const [countRows] = await pool.query<RowDataPacket[]>(`
        SELECT COUNT(*) as total FROM ck_stages WHERE \`map\` = ? AND stage = ?
      `, [mapname, stage]);
      const totalRecords = countRows[0]?.total || 0;

      // Get stage records with pagination using window function
      const [stageRows] = await pool.query<StageRecord[]>(`
        SELECT 
          s.steamid, pr.name, s.stage, s.runtime, s.date, s.startspeed,
          ROW_NUMBER() OVER (ORDER BY s.runtime ASC) as rank,
          (SELECT MIN(runtime) FROM ck_stages WHERE map = s.map AND stage = s.stage) as wr_time
        FROM ck_stages s
        LEFT JOIN ck_playerrank pr ON s.steamid = pr.steamid
        WHERE s.map = ? AND s.stage = ?
        ORDER BY s.runtime ASC
        LIMIT ? OFFSET ?
      `, [mapname, stage, pageSize, offset]);

      logger.debug(`[API] Fetched ${stageRows.length} stage records for ${mapname} stage ${stage}`);

      return {
        stages: stageRows,
        stagesList,
        pagination: {
          stage,
          page,
          pageSize,
          offset,
          total: totalRecords,
          totalPages: Math.ceil(totalRecords / pageSize),
        },
      };
    } catch (error: any) {
      logger.error(`[API] Failed to fetch stage records for ${mapname}: ${error.message}`);
      throw error;
    }
  },
  ['stage-records'],
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
  const stage = parseInt(searchParams.get('stage') || '1', 10);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const data = await getStageRecords(validMapname, stage, page, pageSize);
    return NextResponse.json(data);
  } catch (error: any) {
    logger.error(`[API] Failed to fetch stage records for ${validMapname}: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch stage records' },
      { status: 500 }
    );
  }
}
