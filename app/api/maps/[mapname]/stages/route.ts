import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateMapName, validateSearchQuery } from '@/lib/validators';
import logger from '@/lib/logger';
import { getStageRecordsFromCache, searchStageRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getStagesByMapFromCache } from '@/lib/valkey-registry-cache';

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
  const stage = parseInt(searchParams.get('stage') || '1', 10);
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
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
      });
    } catch (error: unknown) {
      const err = error as { message?: string };
      logger.error(`[API] Stage search failed for ${validMapname}: ${err.message || 'Unknown error'}`);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }
  }

  const sortField = searchParams.get('sortField') || 'rank';
  const sortOrder = searchParams.get('sortOrder') || 'ASC';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
  );
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
    const err = error as { message?: string };
    logger.error(`[API] Failed to fetch stage records for ${validMapname}: ${err.message || 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Failed to fetch stage records' },
      { status: 500 }
    );
  }
}
