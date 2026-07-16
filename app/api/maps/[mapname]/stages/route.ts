import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSearchQuery } from '@/lib/validators';
import { resolveMapnameParam, parsePageParams, apiError, SEARCH_CACHE_CONTROL, RECORDS_CACHE_CONTROL } from '@/lib/api-utils';
import { parseIntParam } from '@/lib/utils';
import { getStageRecordsFromCache, searchStageRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getStagesByMapFromCache } from '@/lib/valkey-registry-cache';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

// sortField/sortOrder only feed the cache key (SQL is always rank-ordered).
// Restrict to a known set so arbitrary values can't mint unbounded cache keys.
const ALLOWED_SORT_FIELDS = new Set(['rank', 'player', 'time', 'wrDiff', 'speed', 'date']);
const DEFAULT_SORT_FIELD = 'rank';
const DEFAULT_SORT_ORDER = 'ASC';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const validMapname = resolveMapnameParam(mapname);
  if (validMapname instanceof NextResponse) return validMapname;

  const searchParams = request.nextUrl.searchParams;
  const stage = parseIntParam(searchParams.get('stage'), { fallback: 1, min: 1 });
  const rawQuery = searchParams.get('q');

  // Only stages with records exist in the registry; reject others up front so
  // invalid values can't trigger the heavy DENSE_RANK query.
  const stagesList = await getStagesByMapFromCache(validMapname);
  const stageExists = stagesList.includes(stage);

  // Search mode: return all matching records (up to 100) with true global ranks
  if (rawQuery !== null) {
    const query = validateSearchQuery(rawQuery);
    if (!query || query.length < 3) {
      return NextResponse.json({ error: 'Search query must be at least 3 characters' }, { status: 400 });
    }
    if (!stageExists) {
      return NextResponse.json({ stages: [], total: 0 }, { headers: { 'Cache-Control': SEARCH_CACHE_CONTROL } });
    }
    try {
      const { stages } = await searchStageRecordsFromCache(validMapname, stage, query);
      return NextResponse.json({ stages, total: stages.length }, {
        headers: { 'Cache-Control': SEARCH_CACHE_CONTROL },
      });
    } catch (error: unknown) {
      return apiError(`[API] Stage search failed for ${validMapname}`, error, 'Search failed');
    }
  }

  const rawSortField = searchParams.get('sortField');
  const sortField = rawSortField && ALLOWED_SORT_FIELDS.has(rawSortField) ? rawSortField : DEFAULT_SORT_FIELD;
  const sortOrder = searchParams.get('sortOrder')?.toUpperCase() === 'DESC' ? 'DESC' : DEFAULT_SORT_ORDER;
  const { page, pageSize } = parsePageParams(searchParams, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  if (!stageExists) {
    return NextResponse.json({
      stages: [],
      stagesList,
      pagination: { stage, page, pageSize, offset, total: 0, totalPages: 0 },
    }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  }

  try {
    const data = await getStageRecordsFromCache(
      validMapname,
      stage,
      sortField,
      sortOrder,
      pageSize,
      offset
    );

    return NextResponse.json({
      ...data,
      stagesList,
    }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch stage records for ${validMapname}`, error, 'Failed to fetch stage records');
  }
}
