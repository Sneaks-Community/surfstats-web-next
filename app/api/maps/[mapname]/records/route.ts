import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSearchQuery } from '@/lib/validators';
import { resolveMapnameParam, parsePageParams, apiError, SEARCH_CACHE_CONTROL, RECORDS_CACHE_CONTROL } from '@/lib/api-utils';
import { MIN_SEARCH_LENGTH } from '@/lib/utils';
import {
  getRecordCountsAndWRFromCache,
  getLeaderboardRecordsFromCache,
  searchLeaderboardRecordsFromCache,
} from '@/lib/map-records-cache';
import { getMapMetadataFromCache } from '@/lib/map-cache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const validMapname = resolveMapnameParam(mapname);
  if (validMapname instanceof NextResponse) return validMapname;

  // Existence check on a key the map page warms for every real map; a miss writes nothing
  // (cachedFetch never caches null). The stage and bonus routes get this from the registry.
  if (!(await getMapMetadataFromCache(validMapname))) {
    return NextResponse.json({ error: 'Map not found' }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const rawQuery = searchParams.get('q');

  // Search mode: every match (up to 100), by rank.
  if (rawQuery !== null) {
    const query = validateSearchQuery(rawQuery);
    if (query.length < MIN_SEARCH_LENGTH) {
      return NextResponse.json({ records: [], total: 0 }, { headers: { 'Cache-Control': SEARCH_CACHE_CONTROL } });
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

  const { page, pageSize } = parsePageParams(searchParams);

  try {
    const { counts, wr_time } = await getRecordCountsAndWRFromCache(validMapname);
    // Clamp page to the real page count: bounds cache keys and OFFSET size.
    const totalPages = Math.max(1, Math.ceil(counts.leaderboardTotal / pageSize));
    const clampedPage = Math.min(page, totalPages);
    const { records } = await getLeaderboardRecordsFromCache(validMapname, clampedPage, pageSize, wr_time);

    return NextResponse.json({
      records,
      pagination: {
        page: clampedPage,
        pageSize,
        offset: (clampedPage - 1) * pageSize,
        total: counts.leaderboardTotal,
        totalPages,
      },
      wr_time,
    }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch records for ${validMapname}`, error, 'Failed to fetch records');
  }
}
