import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { validateMapName, validateSearchQuery } from '@/lib/validators';
import logger from '@/lib/logger';
import { getBonusRecordsFromCache, searchBonusRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getBonusGroupsByMapFromCache } from '@/lib/valkey-registry-cache';

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
  const bonus = Math.max(1, parseInt(searchParams.get('bonus') || '1', 10));
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
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
      });
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error(`[API] Bonus search failed for ${validMapname}: ${err.message || 'Unknown error'}`);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
  }

  // Pagination mode
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const data = await getBonusRecordsFromCache(validMapname, bonus, page, pageSize);
    const bonusGroupsList = await getBonusGroupsByMapFromCache(validMapname);

    return NextResponse.json({
      ...data,
      bonusGroupsList,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[API] Failed to fetch bonus records for ${validMapname}: ${err.message || 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Failed to fetch bonus records' },
      { status: 500 }
    );
  }
}
