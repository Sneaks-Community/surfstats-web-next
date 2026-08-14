import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { validateSearchQuery } from '@/lib/validators';
import { resolveMapnameParam, parsePageParams, apiError, SEARCH_CACHE_CONTROL, RECORDS_CACHE_CONTROL, RECORDS_PAGE_SIZE } from '@/lib/api-utils';
import { parseIntParam } from '@/lib/utils';
import { getBonusRecordsFromCache, searchBonusRecordsFromCache, getRecordCountsAndWRFromCache } from '@/lib/map-records-cache';
import { getBonusGroupsByMapFromCache } from '@/lib/registry-cache';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const validMapname = resolveMapnameParam(mapname);
  if (validMapname instanceof NextResponse) return validMapname;

  const searchParams = request.nextUrl.searchParams;
  const bonus = parseIntParam(searchParams.get('bonus'), { fallback: 1, min: 1 });
  const rawQuery = searchParams.get('q');

  // Reject bonus zones that don't exist for this map before any heavy query.
  const bonusGroupsList = await getBonusGroupsByMapFromCache(validMapname);
  const bonusExists = bonusGroupsList.includes(bonus);

  // Search mode: return all matching records (up to 100) for this bonus zone
  if (rawQuery !== null) {
    const query = validateSearchQuery(rawQuery);
    if (!query || query.length < 3) {
      return NextResponse.json({ error: 'Search query must be at least 3 characters' }, { status: 400 });
    }
    if (!bonusExists) {
      return NextResponse.json({ records: [], total: 0 }, { headers: { 'Cache-Control': SEARCH_CACHE_CONTROL } });
    }

    try {
      const { records } = await searchBonusRecordsFromCache(validMapname, bonus, query);
      return NextResponse.json({ records, total: records.length }, {
        headers: { 'Cache-Control': SEARCH_CACHE_CONTROL },
      });
    } catch (error: unknown) {
      return apiError(`[API] Bonus search failed for ${validMapname}`, error, 'Search failed');
    }
  }

  // Pagination mode
  const { page, pageSize } = parsePageParams(searchParams, RECORDS_PAGE_SIZE, RECORDS_PAGE_SIZE);

  if (!bonusExists) {
    return NextResponse.json({
      bonuses: [],
      bonusGroupsList,
      pagination: { bonus, page, pageSize, offset: (page - 1) * pageSize, total: 0, totalPages: 0 },
    }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  }

  try {
    // Clamp page like records/route.ts: bounds cache keys and OFFSET size. This
    // count covers every zonegroup on the map rather than just this one, so it
    // over-estimates and can never truncate a real page — and the records tab
    // already warms the key, so no new query shape enters the system.
    const { counts } = await getRecordCountsAndWRFromCache(validMapname);
    const totalPages = Math.max(1, Math.ceil(counts.bonusesTotal / pageSize));
    const data = await getBonusRecordsFromCache(validMapname, bonus, Math.min(page, totalPages), pageSize);

    return NextResponse.json({
      ...data,
      bonusGroupsList,
    }, {
      headers: { 'Cache-Control': RECORDS_CACHE_CONTROL },
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch bonus records for ${validMapname}`, error, 'Failed to fetch bonus records');
  }
}
