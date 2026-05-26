import { NextResponse } from 'next/server';
import client from '@/lib/valkey';

export async function GET() {
  const healthStatus: Record<string, string | boolean | number> = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };

  let overallHealthy = true;

  // Check Valkey connectivity
  try {
    const pong = await client.ping();
    healthStatus.valkey = pong === 'PONG' ? 'connected' : 'unknown';
    if (pong !== 'PONG') {
      overallHealthy = false;
    }
  } catch (error) {
    const err = error as { message?: string };
    healthStatus.valkey = `error: ${err.message || 'Unknown error'}`;
    overallHealthy = false;
  }

  // Check database connectivity (non-blocking, don't wait)
  try {
    const { default: pool } = await import('@/lib/db');
    await pool.query('SELECT 1');
    healthStatus.database = 'connected';
  } catch (error) {
    const err = error as { message?: string };
    healthStatus.database = `error: ${err.message || 'Unknown error'}`;
    overallHealthy = false;
  }

  const statusCode = overallHealthy ? 200 : 503;
  
  return NextResponse.json(healthStatus, { status: statusCode });
}
