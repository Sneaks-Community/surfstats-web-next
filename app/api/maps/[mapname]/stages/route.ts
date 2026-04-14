import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import type { NextRequest } from 'next/server';
import type { RowDataPacket } from 'mysql2';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import { unstable_cache } from 'next/cache';
import { withTimeout } from '@/lib/timeout';
import { getStagesByMap } from '@/lib/registry-cache';

const TOP_RECORDS_LIMIT = 100;
const MAX_STAGE_RECORDS = 100;
const QUERY_TIMEOUT_MS = 30000; // 30 seconds - prevents indefinite query hanging

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
// Cache key includes mapname, stage, sortField, sortOrder, pageSize, and offset
const getStageRecords = unstable_cache(
  async (
    mapname: string,
    stage: number,
    sortField: string,
    sortOrder: string,
    pageSize: number,
    offset: number
  ): Promise<StagesResponse> => {
    try {
      // Get list of all stages from registry cache (already cached for 1 hour)
      const stagesList = await getStagesByMap(mapname);

      // Build ORDER BY clause based on sort field
      // NOTE: For stages, we always fetch top 100 by rank (runtime ASC) first
      // Client-side sorting handles other sort fields
      
      // Validate sort field to prevent SQL injection
      const validSortFields = new Set(['rank', 'player', 'time', 'speed', 'date']);
      if (!validSortFields.has(sortField)) {
        sortField = 'rank'; // Default to safe value
      }
      
      // Validate sort order to prevent SQL injection
      const validDirections = new Set(['ASC', 'DESC']);
      const _orderDirection = validDirections.has(sortOrder.toUpperCase())
        ? sortOrder.toUpperCase()
        : 'ASC';
      
      // orderByClause is built but not used - the actual ORDER BY is hardcoded in the query
      // Keeping this for potential future use or documentation
      const _orderByClause = 'runtime ASC'; // Default to runtime
      if (sortField === 'rank') {
        // _orderByClause = 'runtime ASC';
      } else if (sortField === 'player') {
        // _orderByClause = `name ${orderDirection}, runtime ASC`;
      } else if (sortField === 'time') {
        // _orderByClause = `runtime ${orderDirection}`;
      } else if (sortField === 'speed') {
        // _orderByClause = `startspeed ${orderDirection}, runtime ASC`;
      } else if (sortField === 'date') {
        // _orderByClause = `date ${orderDirection}, runtime ASC`;
      }

      // PARALLEL: Execute count, wr_time, and rankCount queries simultaneously
      // These queries have no dependencies on each other
      const [countResult, wrResult, rankCountResult] = await Promise.all([
        withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT COUNT(*) as total FROM ck_stages WHERE \`map\` = ? AND stage = ?
          `, [mapname, stage]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        ),
        withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT MIN(runtime) as wr_time FROM ck_stages WHERE map = ? AND stage = ?
          `, [mapname, stage]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        ),
        withTimeout(
          pool.query<RowDataPacket[]>(`
            SELECT COUNT(DISTINCT rank) as total FROM (
              SELECT
                s.steamid,
                DENSE_RANK() OVER (ORDER BY s.runtime ASC, s.date ASC) as rank
              FROM ck_stages s
              WHERE s.map = ? AND s.stage = ?
            ) AS ranked
          `, [mapname, stage]),
          QUERY_TIMEOUT_MS,
          'Query timeout exceeded'
        )
      ]);

      // Extract results from parallel execution
      const [countRows] = countResult;
      const [wrRows] = wrResult;
      const [rankCountRows] = rankCountResult;
      
      const _totalRecords = countRows[0]?.total || 0;
      const wrTime = wrRows[0]?.wr_time || null;
      const totalWithRank = rankCountRows[0]?.total || 0;

      // Get stage records with rank calculation
      // Return all top 100 records sorted by rank for UI to handle pagination and sorting
      // This query depends on wr_time, so it executes after the parallel queries
      const [stageRows] = await withTimeout(
        pool.query<StageRecord[]>(`
          SELECT
            steamid, name, stage, runtime, date, startspeed, rank, wr_time
          FROM (
            SELECT
              s.steamid,
              pr.name,
              s.stage,
              s.runtime,
              s.date,
              s.startspeed,
              DENSE_RANK() OVER (ORDER BY s.runtime ASC, s.date ASC) as rank,
              ? as wr_time
            FROM ck_stages s
            LEFT JOIN ck_playerrank pr ON s.steamid = pr.steamid
            WHERE s.map = ? AND s.stage = ?
          ) AS ranked_data
          WHERE rank <= ?
          ORDER BY rank ASC, date ASC
        `, [wrTime, mapname, stage, MAX_STAGE_RECORDS]),
        QUERY_TIMEOUT_MS,
        'Query timeout exceeded'
      );

      logger.debug(`[API] Fetched ${stageRows.length} stage records for ${mapname} stage ${stage} (sort: ${sortField} ${sortOrder}, page: ${Math.floor(offset / pageSize) + 1})`);

      // Cap total records at MAX_STAGE_RECORDS (100)
      const cappedTotal = Math.min(totalWithRank, MAX_STAGE_RECORDS);
      const cappedTotalPages = Math.ceil(cappedTotal / pageSize);

      return {
        stages: stageRows,
        stagesList,
        pagination: {
          stage,
          page: Math.floor(offset / pageSize) + 1,
          pageSize,
          offset,
          total: cappedTotal,
          totalPages: cappedTotalPages,
        },
      };
    } catch (error: unknown) {
      const err = error as { message?: string };
      if (err.message === 'Query timeout exceeded') {
        logger.error(`[API] Query timeout for ${mapname} stage ${stage} after ${QUERY_TIMEOUT_MS / 1000} seconds`);
        return {
          stages: [],
          stagesList: [],
          pagination: {
            stage,
            page: Math.floor(offset / pageSize) + 1,
            pageSize,
            offset,
            total: 0,
            totalPages: 0,
          },
        };
      }
      logger.error(`[API] Failed to fetch stage records for ${mapname}: ${err.message || 'Unknown error'}`);
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
  const stage = parseInt(searchParams.get('stage') || '1', 10);
  const sortField = searchParams.get('sort') || 'rank';
  const sortOrder = searchParams.get('order') || 'asc';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || TOP_RECORDS_LIMIT.toString(), 10);
  const offset = (page - 1) * pageSize;

  try {
    const data = await getStageRecords(validMapname, stage, sortField, sortOrder, pageSize, offset);
    return NextResponse.json(data);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[API] Failed to fetch top stage records for ${validMapname}: ${err.message || 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Failed to fetch stage records' },
      { status: 500 }
    );
  }
}
