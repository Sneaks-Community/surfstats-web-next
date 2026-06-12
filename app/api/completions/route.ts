import { NextResponse } from 'next/server';
import { getLatestCompletionsFromCache } from '@/lib/cache';
import logger from '@/lib/logger';
import { getErrorMessage } from '@/lib/errors';

export async function GET() {
  try {
    const completions = await getLatestCompletionsFromCache();
    return NextResponse.json(completions);
  } catch (error: unknown) {
    logger.error(`[API Completions] GET failed: ${getErrorMessage(error)}`);
    return NextResponse.json(
      { error: 'Failed to fetch latest completions' },
      { status: 500 }
    );
  }
}
