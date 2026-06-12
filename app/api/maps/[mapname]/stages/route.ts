import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateSearchQuery } from '@/lib/validators';
import { resolveMapnameParam, parsePageParams, apiError, SEARCH_CACHE_CONTROL } from '@/lib/api-utils';
import { parseIntParam } from '@/lib/utils';
import { getStageRecordsFromCache, searchStageRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getStagesByMapFromCache } from '@/lib/valkey-registry-cache';

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
  const stage = parseIntParam(searchParams.get('stage'), { fallback: 1, min: 1 });
  const rawQuery = searchParams.get('q');

  // Search mode: return all matching records (up to 100) with true global ranks
  if (rawQuery !== null) {
    const query = validateSearchQuery(rawQuery);
    if (!query || query.length < 3) {
      return NextResponse.json({ error: 'Search query must be at least 3 characters' }, { status: 400 });
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

  const sortField = searchParams.get('sortField') || 'rank';
  const sortOrder = searchParams.get('sortOrder') || 'ASC';
  const { page, pageSize } = parsePageParams(searchParams, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const offset = (page - 1) * pageSize;

  try {
    const data = await getStageRecordsFromCache(
      validMapname,
      stage,
      sortField,
      sortOrder,
      pageSize,
      offset
    );

    // Get stages list from Valkey cache
    const stagesList = await getStagesByMapFromCache(validMapname);

    return NextResponse.json({
      ...data,
      stagesList,
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch stage records for ${validMapname}`, error, 'Failed to fetch stage records');
  }
}
