import { NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { resolveMapnameParam, apiError } from '@/lib/api-utils';
import { getMapChartDataFromCache } from '@/lib/valkey-map-stats-cache';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mapname: string }> }
) {
  const { mapname } = await params;
  const validMapname = resolveMapnameParam(mapname);
  if (validMapname instanceof NextResponse) return validMapname;

  try {
    const chartData = await getMapChartDataFromCache(validMapname);

    logger.debug(`[API Stats] Fetched stats for ${validMapname}: ${chartData.completionsOverTime.length} time points, ${chartData.checkpointAvgTimes.length} checkpoints, ${Object.keys(chartData.bonusCompletionsOverTime).length} bonus time series, ${chartData.wrCheckpointTimes ? chartData.wrCheckpointTimes.length : 0} WR checkpoint times, percentileTimes: ${chartData.percentileTimes ? `wr=${chartData.percentileTimes.wrTime?.toFixed(1) ?? 'null'}s` : 'null'}`);

    return NextResponse.json(chartData);
  } catch (error: unknown) {
    return apiError(`[API Stats] Failed to fetch stats for ${validMapname}`, error, 'Failed to fetch map statistics');
  }
}
