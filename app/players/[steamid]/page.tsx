import Link from 'next/link';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { validateSteamId } from '@/lib/validators';
import { getTotalsFromCache } from '@/lib/cache';
import { getPlayerTimeOnServerFromCache, getActivityHeatmapFromCache } from '@/lib/player-analytics';
import { getTierDistributionFromCache } from '@/lib/valkey-map-cache';
import { getPlayerNameFromCache } from '@/lib/player-cache';
import { getPlayerOverviewFromCache, getPlayerWrPerformanceFromCache, getLinearVsStagedPerTierFromCache } from '@/lib/player-profile-cache';
import type { TierDistributionRow } from '@/lib/player-profile-cache';
import logger from '@/lib/logger';
import PlayerProfileContent from './components/PlayerProfileContent';
import { getErrorMessage } from '@/lib/errors';

// Highest tier the Tier Distribution radar will render. Defaults to 10.
const MAX_ALLOWED_TIER = parseInt(process.env.MAX_TIER || '10', 10) || 10;

/**
 * Zero-fill the player's per-tier completions across the full tier range
 * `1..maxTier`, so the radar chart shows every tier the server supports (with
 * un-completed tiers at zero) and never silently drops a tier. `maxTier` comes
 * from the server's actual map pool, so a server with tiers up to 6 renders
 * 1-6 and a server with tiers up to 10 renders 1-10 — no blank trailing axes.
 *
 * When the player has no completions at all, returns an empty array so the
 * chart renders its "No completions" empty state instead of an all-zero radar.
 */
function padTierDistribution(rows: TierDistributionRow[], maxTier: number): TierDistributionRow[] {
  if (rows.length === 0) return [];

  const byTier = new Map(rows.map(r => [r.tier, r]));
  const distribution: TierDistributionRow[] = [];
  for (let tier = 1; tier <= maxTier; tier++) {
    distribution.push(byTier.get(tier) ?? { tier, linear: 0, staged: 0 });
  }
  return distribution;
}

export async function generateMetadata({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params;
  const decodedSteamId = decodeURIComponent(steamid);
  const validSteamId = validateSteamId(decodedSteamId);
  
  if (!validSteamId) {
    return {
      title: 'Invalid SteamID',
    };
  }

  try {
    const { name } = await getPlayerNameFromCache(validSteamId);

    if (!name) {
      return {
        title: 'Player Not Found',
      };
    }

    const siteName = process.env.NEXT_PUBLIC_SITE_NAME || 'SurfStats';
    const description = `View ${name}'s CS:GO surf statistics, records, rankings, and completions on ${siteName}.`;

    return {
      title: `${name} - Player Profile`,
      description,
      openGraph: {
        type: 'profile',
        siteName,
        title: `${name} - Player Profile - ${siteName}`,
        description,
      },
    };
  } catch (error: unknown) {
    logger.error(`[Player] Failed to generate metadata for ${validSteamId}: ${getErrorMessage(error)}`);
    return {
      title: 'Player Profile',
    };
  }
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ steamid: string }>;
}) {
  const { steamid } = await params;
  const decodedSteamId: string = decodeURIComponent(steamid);
  
  // Validate and sanitize SteamID input
  const validSteamId = validateSteamId(decodedSteamId) ?? decodedSteamId;
  if (!validSteamId) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Invalid SteamID</h1>
        <p className="text-text-muted">The provided SteamID format is invalid.</p>
        <Link href="/players" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
          Back to Players
        </Link>
      </div>
    );
  }
  
  const overview = await getPlayerOverviewFromCache(validSteamId);

  if (!overview) {
    return (
      <div className="text-center py-20 bg-surface border border-border rounded-xl">
        <h1 className="text-2xl font-bold text-text mb-2">Player Not Found</h1>
        <p className="text-text-muted">The player with SteamID {decodedSteamId} could not be found.</p>
        <Link href="/players" className="inline-block mt-6 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white rounded-md transition-colors">
          Back to Players
        </Link>
      </div>
    );
  }

  const [totals, steamAvatars, playtimeData, linearVsStagedRaw, activityHeatmap, tierDistribution, wrPerformanceData] = await Promise.all([
    getTotalsFromCache(),
    getSteamProfilesFromCache([decodedSteamId]),
    getPlayerTimeOnServerFromCache(validSteamId),
    getLinearVsStagedPerTierFromCache(validSteamId),
    getActivityHeatmapFromCache(validSteamId),
    getTierDistributionFromCache(),
    getPlayerWrPerformanceFromCache(validSteamId),
  ]);

  // The tier ceiling is a property of the server's map pool, not the player.
  // Derive it from the server-wide tier distribution (falling back to the
  // player's own completed tiers) so the chart shows exactly the tiers this
  // server supports. Ignore any tier above MAX_ALLOWED_TIER (default 10, the
  // ckSurf tier ceiling; override via the MAX_TIER env var): higher values are
  // placeholder/junk data (e.g. a tier-69 stub map) that would otherwise blow
  // the radar up to dozens of empty axes.
  const candidateTiers = [
    ...tierDistribution.keys(),
    ...linearVsStagedRaw.map(r => r.tier),
  ].filter(t => t >= 1 && t <= MAX_ALLOWED_TIER);
  const maxTier = candidateTiers.length > 0 ? Math.max(...candidateTiers) : 1;
  const linearVsStagedPerTier = padTierDistribution(linearVsStagedRaw, maxTier);

  return (
    <div className="space-y-4">
      <PlayerProfileContent
        overview={overview}
        totals={totals}
        steamAvatars={steamAvatars}
        playtimeData={playtimeData}
        linearVsStagedPerTier={linearVsStagedPerTier}
        wrPerformanceData={wrPerformanceData}
        activityHeatmap={activityHeatmap}
        steamid={validSteamId}
      />
    </div>
  );
}
