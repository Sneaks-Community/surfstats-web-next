import Link from 'next/link';
import { Users, Map as MapIcon, Trophy, Clock, Activity, Server } from 'lucide-react';
import { formatTime, formatDate } from '@/lib/utils';
import { getStatsCached } from '@/lib/cache';
import logger from '@/lib/logger';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';

// Force dynamic rendering to prevent static generation
export const dynamic = 'force-dynamic';

// Wrapper that catches errors and returns null for display
async function getStats() {
  try {
    const stats = await getStatsCached();
    logger.debug('[Home] Stats loaded successfully');
    return stats;
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Home] Failed to load stats: ${errorMessage}`);
    logger.error('[Home] Dashboard will display without stats data');
    return null;
  }
}

export default async function Home() {
  const stats = await getStats();

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          <section>
            <h1 className="text-4xl font-bold tracking-tight text-text mb-2">Welcome to {process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats'}</h1>
            <p className="text-text-muted text-lg">
              {process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'Statistics, leaderboards, and server information for our CS:GO surf community.'}
            </p>
          </section>

          {/* Stats Grid */}
          {stats && (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center text-center">
                <Users className="h-8 w-8 text-primary mb-3" />
                <span className="text-3xl font-bold text-text">{stats.playerCount.toLocaleString()}</span>
                <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Total Players</span>
              </div>
              <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center text-center">
                <Activity className="h-8 w-8 text-blue-500 mb-3" />
                <span className="text-3xl font-bold text-text">{stats.playersMonth.toLocaleString()}</span>
                <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Active (30d)</span>
              </div>
              <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center text-center">
                <MapIcon className="h-8 w-8 text-purple-500 mb-3" />
                <span className="text-3xl font-bold text-text">{stats.mapCompletions.toLocaleString()}</span>
                <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Map Completions</span>
              </div>
              <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center text-center">
                <Trophy className="h-8 w-8 text-yellow-500 mb-3" />
                <span className="text-3xl font-bold text-text">{stats.totalPoints.toLocaleString()}</span>
                <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Total Points</span>
              </div>
              <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center text-center">
                <Clock className="h-8 w-8 text-orange-500 mb-3" />
                <span className="text-3xl font-bold text-text">{stats.bonusCompletions.toLocaleString()}</span>
                <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Bonus Completions</span>
              </div>
              <div className="bg-surface border border-border rounded-xl p-6 flex flex-col items-center text-center">
                <Clock className="h-8 w-8 text-pink-500 mb-3" />
                <span className="text-3xl font-bold text-text">{stats.stageCompletions.toLocaleString()}</span>
                <span className="text-sm text-text-muted uppercase tracking-wider font-semibold mt-1">Stage Completions</span>
              </div>
            </section>
          )}

          {/* Recent Records */}
          {stats && stats.recentRecords.length > 0 && (
            <section className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-border bg-surface/50">
                <h2 className="text-lg font-semibold text-text flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Latest Records
                </h2>
              </div>
              <div className="divide-y divide-border">
                {stats.recentRecords.map((record, i) => (
                  <div key={i} className="px-6 py-4 flex items-center justify-between hover:bg-surface-hover/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="bg-surface-hover rounded-md p-2">
                        <MapIcon className="h-5 w-5 text-text-muted" />
                      </div>
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
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          <section className="bg-surface border border-border rounded-xl p-6">
            <h2 className="text-lg font-semibold text-text mb-4">Quick Links</h2>
            <div className="space-y-3">
              <a href="https://snksrv.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 rounded-lg bg-surface-hover hover:bg-surface-active transition-colors group">
                <span className="font-medium text-text group-hover:text-text">Main Website</span>
                <Activity className="h-4 w-4 text-text-muted group-hover:text-primary" />
              </a>
              <Link href="/servers" className="flex items-center justify-between p-3 rounded-lg bg-surface-hover hover:bg-surface-active transition-colors group">
                <span className="font-medium text-text group-hover:text-text">Live Servers</span>
                <Server className="h-4 w-4 text-text-muted group-hover:text-blue-400" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}