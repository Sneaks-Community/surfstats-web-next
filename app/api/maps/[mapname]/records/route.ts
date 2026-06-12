import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSearchQuery } from '@/lib/validators';
import { resolveMapnameParam, parsePageParams, apiError, SEARCH_CACHE_CONTROL } from '@/lib/api-utils';
import {
  getRecordCountsAndWRFromCache,
  getLeaderboardRecordsFromCache,
  searchLeaderboardRecordsFromCache,
} from '@/lib/valkey-map-records-cache';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const validMapname = resolveMapnameParam(mapname);
  if (validMapname instanceof NextResponse) return validMapname;

  const searchParams = request.nextUrl.searchParams;
  const rawQuery = searchParams.get('q');

  // Search mode: return all matching records (up to 100) sorted by rank
  if (rawQuery !== null) {
    const query = validateSearchQuery(rawQuery);
    if (!query || query.length < 3) {
      return NextResponse.json({ error: 'Search query must be at least 3 characters' }, { status: 400 });
    }

    try {
      const { records, wr_time } = await searchLeaderboardRecordsFromCache(validMapname, query);
      return NextResponse.json({ records, wr_time, total: records.length }, {
        headers: { 'Cache-Control': SEARCH_CACHE_CONTROL },
      });
    } catch (error: unknown) {
      return apiError(`[API] Search failed for ${validMapname}`, error, 'Search failed');
    }
  }

  // Pagination mode
  const { page, pageSize } = parsePageParams(searchParams, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  try {
    const { counts, wr_time } = await getRecordCountsAndWRFromCache(validMapname);
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
    return apiError(`[API] Failed to fetch records for ${validMapname}`, error, 'Failed to fetch records');
  }
}
