import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { validateSearchQuery } from '@/lib/validators';
import { resolveMapnameParam, parsePageParams, apiError, SEARCH_CACHE_CONTROL } from '@/lib/api-utils';
import { parseIntParam } from '@/lib/utils';
import { getBonusRecordsFromCache, searchBonusRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getBonusGroupsByMapFromCache } from '@/lib/valkey-registry-cache';

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
  const bonus = parseIntParam(searchParams.get('bonus'), { fallback: 1, min: 1 });
  const rawQuery = searchParams.get('q');

  // Search mode: return all matching records (up to 100) for this bonus zone
  if (rawQuery !== null) {
    const query = validateSearchQuery(rawQuery);
    if (!query || query.length < 3) {
      return NextResponse.json({ error: 'Search query must be at least 3 characters' }, { status: 400 });
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
  const { page, pageSize } = parsePageParams(searchParams, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  try {
    const data = await getBonusRecordsFromCache(validMapname, bonus, page, pageSize);
    const bonusGroupsList = await getBonusGroupsByMapFromCache(validMapname);

    return NextResponse.json({
      ...data,
      bonusGroupsList,
    });
  } catch (error: unknown) {
    return apiError(`[API] Failed to fetch bonus records for ${validMapname}`, error, 'Failed to fetch bonus records');
  }
}
