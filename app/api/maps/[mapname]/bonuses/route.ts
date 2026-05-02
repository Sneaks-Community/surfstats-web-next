import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { validateMapName } from '@/lib/validators';
import logger from '@/lib/logger';
import { getBonusRecordsFromCache } from '@/lib/valkey-map-records-cache';
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
  const bonus = parseInt(searchParams.get('bonus') || '1', 10);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, parseInt(searchParams.get('pageSize') || String(DEFAULT_PAGE_SIZE), 10))
  );

  try {
    const data = await getBonusRecordsFromCache(validMapname, bonus, page, pageSize);

    // Get bonus groups list from Valkey cache
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
