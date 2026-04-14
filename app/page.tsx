import Link from 'next/link';
import { Users, Map as MapIcon, Trophy, Clock, Activity } from 'lucide-react';
import { formatTime, formatDate } from '@/lib/utils';
import { getStatsCached, getLatestCompletionsCached } from '@/lib/cache';
import logger from '@/lib/logger';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import MapImage from '@/components/MapImage';

// Force dynamic rendering to prevent static generation
export const dynamic = 'force-dynamic';

// Wrapper that catches errors and returns null for display
async function getStats() {
  try {
    const stats = await getStatsCached();
    logger.debug('[Home] Stats loaded successfully');
    return stats;
  } catch (error: unknown) {
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Home] Failed to load stats: ${errorMessage}`);
    logger.error('[Home] Dashboard will display without stats data');
    return null;
  }
}

// Wrapper that catches errors and returns null for display
async function getLatestCompletions() {
  try {
    const completions = await getLatestCompletionsCached();
    logger.debug('[Home] Latest completions loaded successfully');
    return completions;
  } catch (error: unknown) {
    const err = error as { message?: string };
    const errorMessage = err.message || 'Unknown error';
    logger.error(`[Home] Failed to load latest completions: ${errorMessage}`);
    logger.error('[Home] Dashboard will display without completions data');
    return [];
  }
}

export default async function Home() {
  const stats = await getStats();
  const latestCompletions = await getLatestCompletions();


  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <section>
        <h1 className="text-4xl font-bold tracking-tight text-text mb-2">Welcome to {process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats'}</h1>
        <p className="text-text-muted text-lg">
          {process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Statistics, leaderboards, and server information for our CS:GO surf community.'}
        </p>
      </section>

      {/* Stats Grid */}
      {stats && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center">
            <Users className="h-8 w-8 text-primary mb-3" />
            <span className="text-3xl font-bold text-text">{stats.playerCount.toLocaleString()}</span>
            <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Total Players</span>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center">
            <Activity className="h-8 w-8 text-blue-500 mb-3" />
            <span className="text-3xl font-bold text-text">{stats.playersMonth.toLocaleString()}</span>
            <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Active (30d)</span>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center">
            <MapIcon className="h-8 w-8 text-purple-500 mb-3" />
            <span className="text-3xl font-bold text-text">{stats.mapCompletions.toLocaleString()}</span>
            <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Map Completions</span>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center">
            <Trophy className="h-8 w-8 text-yellow-500 mb-3" />
            <span className="text-3xl font-bold text-text">{stats.totalPoints.toLocaleString()}</span>
            <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Total Points</span>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center">
            <Clock className="h-8 w-8 text-orange-500 mb-3" />
            <span className="text-3xl font-bold text-text">{stats.bonusCompletions.toLocaleString()}</span>
            <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Bonus Completions</span>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 flex flex-col items-center text-center">
            <Clock className="h-8 w-8 text-pink-500 mb-3" />
            <span className="text-3xl font-bold text-text">{stats.stageCompletions.toLocaleString()}</span>
            <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Stage Completions</span>
          </div>
        </section>
      )}

      {/* Records and Completions Side by Side */}
      {(stats && stats.recentRecords.length > 0) || latestCompletions.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Latest Records */}
          {stats && stats.recentRecords.length > 0 && (
            <section className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-surface/50">
                <h2 className="text-lg font-semibold text-text flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Latest Records
                </h2>
              </div>
              <div className="divide-y divide-border">
                {stats.recentRecords.map((record, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between hover:bg-surface-hover/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <MapImage
                        src={`${mapImagesUrl}${record.map}.jpg`}
                        alt={`${record.map} thumbnail`}
                        unoptimized
                        width={64}
                        height={64}
                        className="rounded-md"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <MapLinkWithPreview mapname={record.map}>
                          {record.map}
                        </MapLinkWithPreview>
                        <div className="text-sm text-text-muted flex items-center gap-2 mt-1">
                          <span>by</span>
                          <Link href={`/players/${record.steamid}`} className="text-text-muted hover:text-text transition-colors">
                            {record.name || 'Unknown'}
                          </Link>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-lg font-medium text-text">
                        {formatTime(record.runtime)}
                      </div>
                      <div className="text-xs text-text-placeholder mt-1">
                        {formatDate(record.date)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Latest Completions */}
          {latestCompletions.length > 0 && (
            <section className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-surface/50">
                <h2 className="text-lg font-semibold text-text flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-500" />
                  Latest Completions
                </h2>
              </div>
              <div className="divide-y divide-border">
                {latestCompletions.map((completion, i) => (
                  <div key={i} className="px-4 py-3 flex items-center justify-between hover:bg-surface-hover/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <MapImage
                        src={`${mapImagesUrl}${completion.map}.jpg`}
                        alt={`${completion.map} thumbnail`}
                        unoptimized
                        width={64}
                        height={64}
                        className="rounded-md"
                        referrerPolicy="no-referrer"
                      />
                      <div>
                        <MapLinkWithPreview mapname={completion.map}>
                          {completion.map}
                        </MapLinkWithPreview>
                        <div className="text-sm text-text-muted flex items-center gap-2 mt-1">
                          <span>by</span>
                          <Link href={`/players/${completion.steamid}`} className="text-text-muted hover:text-text transition-colors">
                            {completion.name || 'Unknown'}
                          </Link>
                          {completion.type === 'bonus' && completion.bonus && (
                            <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
                              Bonus {completion.bonus}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-lg font-medium text-text">
                        {formatTime(completion.runtime)}
                      </div>
                      <div className="text-xs text-text-placeholder mt-1">
                        {formatDate(completion.date)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
