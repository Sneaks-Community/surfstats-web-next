import { NextResponse } from 'next/server';
import { getLatestCompletionsFromCache } from '@/lib/cache';
import logger from '@/lib/logger';

export async function GET() {
  try {
    const completions = await getLatestCompletionsFromCache();
    return NextResponse.json(completions);
  } catch (error: unknown) {
    const err = error as { message?: string };
    logger.error(`[API Completions] GET failed: ${err.message || 'Unknown error'}`);
    return NextResponse.json(
      { error: 'Failed to fetch latest completions' },
      { status: 500 }
    );
  }
}
