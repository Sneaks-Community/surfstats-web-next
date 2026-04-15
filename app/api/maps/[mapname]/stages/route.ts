import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { sanitizeMapName } from '@/lib/sanitize';
import logger from '@/lib/logger';
import { getStageRecordsFromCache } from '@/lib/valkey-map-records-cache';
import { getStagesByMap } from '@/lib/registry-cache';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;

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

    // Get stages list from registry cache
    const stagesList = await getStagesByMap(validMapname);

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
