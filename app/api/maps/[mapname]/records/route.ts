import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateMapName } from '@/lib/validators';
import logger from '@/lib/logger';
import {
  getRecordCountsAndWRFromCache,
  getLeaderboardRecordsFromCache,
} from '@/lib/valkey-map-records-cache';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const decodedMapname = decodeURIComponent(mapname);
  const validMapname = validateMapName(decodedMapname);

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
    const { counts, wr_time } = await getRecordCountsAndWRFromCache(validMapname);

    // Fetch paginated records, passing wr_time to avoid duplicate query
    const { records } = await getLeaderboardRecordsFromCache(validMapname, page, pageSize, wr_time);

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
