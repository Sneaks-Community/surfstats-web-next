import Link from 'next/link';
import { Users, Map as MapIcon, Trophy, Clock, Activity, Server } from 'lucide-react';
import { formatTime, formatDate } from '@/lib/utils';
import { getStatsCached } from '@/lib/cache';
import logger from '@/lib/logger';

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
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Welcome to SurfStats</h1>
            <p className="text-zinc-400 text-lg">
              The premier destination for CS:GO surf statistics, leaderboards, and community records.
            </p>
          </section>

          {/* Stats Grid */}
          {stats && (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center">
                <Users className="h-8 w-8 text-emerald-500 mb-3" />
                <span className="text-3xl font-bold text-white">{stats.playerCount.toLocaleString()}</span>
                <span className="text-sm text-zinc-400 uppercase tracking-wider font-semibold mt-1">Total Players</span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center">
                <Activity className="h-8 w-8 text-blue-500 mb-3" />
                <span className="text-3xl font-bold text-white">{stats.playersMonth.toLocaleString()}</span>
                <span className="text-sm text-zinc-400 uppercase tracking-wider font-semibold mt-1">Active (30d)</span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center">
                <MapIcon className="h-8 w-8 text-purple-500 mb-3" />
                <span className="text-3xl font-bold text-white">{stats.mapCompletions.toLocaleString()}</span>
                <span className="text-sm text-zinc-400 uppercase tracking-wider font-semibold mt-1">Map Completions</span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center">
                <Trophy className="h-8 w-8 text-yellow-500 mb-3" />
                <span className="text-3xl font-bold text-white">{stats.totalPoints.toLocaleString()}</span>
                <span className="text-sm text-zinc-400 uppercase tracking-wider font-semibold mt-1">Total Points</span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center">
                <Clock className="h-8 w-8 text-orange-500 mb-3" />
                <span className="text-3xl font-bold text-white">{stats.bonusCompletions.toLocaleString()}</span>
                <span className="text-sm text-zinc-400 uppercase tracking-wider font-semibold mt-1">Bonus Completions</span>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center text-center">
                <Clock className="h-8 w-8 text-pink-500 mb-3" />
                <span className="text-3xl font-bold text-white">{stats.stageCompletions.toLocaleString()}</span>
                <span className="text-sm text-zinc-400 uppercase tracking-wider font-semibold mt-1">Stage Completions</span>
              </div>
            </section>
          )}

          {/* Recent Records */}
          {stats && stats.recentRecords.length > 0 && (
            <section className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Latest Records
                </h2>
              </div>
              <div className="divide-y divide-zinc-800">
                {stats.recentRecords.map((record, i) => (
                  <div key={i} className="px-6 py-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="bg-zinc-800 rounded-md p-2">
                        <MapIcon className="h-5 w-5 text-zinc-400" />
                      </div>
                      <div>
                        <Link href={`/maps/${record.map}`} className="text-emerald-400 font-medium hover:underline">
                          {record.map}
                        </Link>
                        <div className="text-sm text-zinc-400 flex items-center gap-2 mt-1">
                          <span>by</span>
                          <Link href={`/players/${record.steamid}`} className="text-zinc-300 hover:text-white transition-colors">
                            {record.name || 'Unknown'}
                          </Link>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-lg font-medium text-white">
                        {formatTime(record.runtime)}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1">
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
          <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Quick Links</h2>
            <div className="space-y-3">
              <a href="https://snksrv.com" target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors group">
                <span className="font-medium text-zinc-200 group-hover:text-white">Main Website</span>
                <Activity className="h-4 w-4 text-zinc-400 group-hover:text-emerald-400" />
              </a>
              <Link href="/servers" className="flex items-center justify-between p-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors group">
                <span className="font-medium text-zinc-200 group-hover:text-white">Live Servers</span>
                <Server className="h-4 w-4 text-zinc-400 group-hover:text-blue-400" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}