import { NextResponse } from 'next/server';
import { getLatestCompletionsCached } from '@/lib/cache';
import logger from '@/lib/logger';

export async function GET() {
  try {
    const completions = await getLatestCompletionsCached();
    return NextResponse.json(completions);
  } catch (error: any) {
    logger.error(`[API Completions] GET failed: ${error.message}`);
    return NextResponse.json(
      { error: 'Failed to fetch latest completions' },
      { status: 500 }
    );
  }
}
