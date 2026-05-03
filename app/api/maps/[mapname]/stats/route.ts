import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { validateMapName } from '@/lib/validators';
import logger from '@/lib/logger';
import {
  getWRCheckpointTimesFromCache,
  getCheckpointStatsFromCache,
  getBonusCompletionsOverTimeFromCache,
  getCompletionsOverTimeFromCache,
  getTimeOnMapDataFromCache,
  getFinishTimeDataFromCache,
  getPercentileTimesFromCache,
} from '@/lib/valkey-map-stats-cache';
import { getMapMetadataFromCache } from '@/lib/valkey-map-cache';

const DEFAULT_DAYS = 365 * 9; // ~9 years to cover data since 2017

interface StatsResponse {
  completionsOverTime: Array<{ date: string; count: number }>;
  timeOnMapData: Array<{ date: string; totalDuration: number }>;
  checkpointAvgTimes: Array<{ checkpoint: number; avgTime: number; sampleSize: number }>;
  wrCheckpointTimes?: Array<{ checkpoint: number; time: number }>;
  finishTime?: {
    avgTime: number; // Average map completion time
    wrTime: number | null; // WR holder's total time
  };
  bonusCompletionsOverTime: Record<number, Array<{ date: string; count: number }>>;
  isStageMap: boolean; // true if map has stages (zonetype 3), false for linear maps (zonetype 4)
  percentileTimes: {
    wrTime: number | null;
    p1Time: number | null;
    p10Time: number | null;
    medianTime: number | null;
    avgTime: number | null;
  } | null;
}

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
  const _days = Math.min(365, Math.max(1, parseInt(searchParams.get('days') || String(DEFAULT_DAYS), 10)));

  try {
    // Get map metadata (already cached with 1 hour TTL in lib/map-cache.ts)
    // This includes completions count and wr_holder_steamid
    const mapMetadata = await getMapMetadataFromCache(validMapname);
    const totalCompletions = mapMetadata?.completions || 0;
    const checkpoints = mapMetadata?.checkpoints || 0;
    const stages = mapMetadata?.stages || 0;
    // For staged maps, use stage count as maxCheckpoint since stages are stored in ck_checkpoints table
    const maxCheckpoint = checkpoints > 0 ? checkpoints : stages;
    const isStageMap = stages > 0;

    if (totalCompletions === 0) {
      // No data available for this map
      return NextResponse.json({
        completionsOverTime: [],
        timeOnMapData: [],
        checkpointAvgTimes: [],
        bonusCompletionsOverTime: {},
        isStageMap,
        percentileTimes: null,
      });
    }

    // Query 1: Completions Over Time (cached)
    const completionsOverTime = await getCompletionsOverTimeFromCache(validMapname);

    // Query 2: Time on Map Data (cached)
    const timeOnMapData = await getTimeOnMapDataFromCache(validMapname);

    // Query 3: Checkpoint Data (Average Times) - use cached checkpoint count
    const { checkpointAvgTimes } = await getCheckpointStatsFromCache(validMapname);

    // Query 4: WR Checkpoint Times (cached)
    const wrCheckpointTimes = await getWRCheckpointTimesFromCache(validMapname, maxCheckpoint);

    // Query 5: Finish Time Data (cached)
    const finishTimeData = await getFinishTimeDataFromCache(validMapname);

    // Query 6: Bonus Completions Over Time (cached)
    const bonusCompletionsOverTime = await getBonusCompletionsOverTimeFromCache(validMapname);

    // Query 7: Percentile Times (cached)
    const percentileTimes = await getPercentileTimesFromCache(validMapname);

    logger.debug(`[API Stats] Fetched stats for ${validMapname}: ${completionsOverTime.length} time points, ${checkpointAvgTimes.length} checkpoints, ${Object.keys(bonusCompletionsOverTime).length} bonus time series, ${wrCheckpointTimes ? wrCheckpointTimes.length : 0} WR checkpoint times, finishTime: ${finishTimeData.avgTime ? finishTimeData.avgTime.toFixed(1) : 'null'}s avg, ${finishTimeData.wrTime ? finishTimeData.wrTime.toFixed(1) : 'null'}s WR, percentileTimes: ${percentileTimes ? `wr=${percentileTimes.wrTime?.toFixed(1) ?? 'null'}s` : 'null'}`);

    return NextResponse.json({
      completionsOverTime,
      timeOnMapData,
      checkpointAvgTimes,
      wrCheckpointTimes,
      finishTime: finishTimeData,
      bonusCompletionsOverTime,
      isStageMap,
      percentileTimes,
    } as StatsResponse);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[API Stats] Failed to fetch stats for ${validMapname}: ${err.message || 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Failed to fetch map statistics' },
      { status: 500 }
    );
  }
}
