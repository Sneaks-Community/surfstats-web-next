import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import client from '@/lib/valkey';
import { getErrorMessage } from '@/lib/errors';
import { isInternalRequest } from '@/lib/internal-network';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  // Cheap public liveness: no dependency round-trips, no status disclosure.
  const liveness: Record<string, string | number> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  // The detailed DB/Valkey probe is an unmetered DoS surface and leaks infra
  // health, so limit it to callers on the internal network.
  if (!isInternalRequest(request)) {
    return NextResponse.json(liveness, { status: 200 });
  }

  const healthStatus: Record<string, string | boolean | number> = { ...liveness };
  let overallHealthy = true;

  // Check Valkey connectivity
  try {
    const pong = await client.ping();
    healthStatus.valkey = pong === 'PONG' ? 'connected' : 'unknown';
    if (pong !== 'PONG') {
      overallHealthy = false;
    }
  } catch (error) {
    logger.error(`[API Health] Valkey check failed: ${getErrorMessage(error)}`);
    healthStatus.valkey = 'error';
    overallHealthy = false;
  }

  // Check database connectivity (non-blocking, don't wait)
  try {
    const { default: pool } = await import('@/lib/db');
    await pool.query('SELECT 1');
    healthStatus.database = 'connected';
  } catch (error) {
    logger.error(`[API Health] Database check failed: ${getErrorMessage(error)}`);
    healthStatus.database = 'error';
    overallHealthy = false;
  }

  const statusCode = overallHealthy ? 200 : 503;

  return NextResponse.json(healthStatus, { status: statusCode });
}
