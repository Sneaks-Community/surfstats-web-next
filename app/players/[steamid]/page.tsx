import { notFound } from 'next/navigation';
import { getSteamProfilesFromCache } from '@/lib/steam';
import { validateSteamId } from '@/lib/validators';
import { getTotalsFromCache } from '@/lib/map-cache';
import { getPlayerTimeOnServerFromCache, getActivityHeatmapFromCache, getPlayerMapEngagementFromCache } from '@/lib/player-analytics';
import { getTierDistributionFromCache } from '@/lib/map-cache';
import { getPlayerNameFromCache } from '@/lib/player-cache';
import { getPlayerOverviewFromCache, getPlayerWrPerformanceFromCache, getLinearVsStagedPerTierFromCache } from '@/lib/player-profile-cache';
import type { TierDistributionRow } from '@/lib/player-profile-cache';
import logger from '@/lib/logger';
import PlayerProfileContent from './components/PlayerProfileContent';
import { getErrorMessage } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { SITE_NAME } from '@/lib/utils';

// Highest tier the Tier Distribution radar will render.
const MAX_ALLOWED_TIER = getEnv().MAX_TIER;

/** Zero-fills tiers 1..maxTier (the pool's ceiling) so the radar drops no tier and has no blank
 * trailing axes. [] for no completions: the chart's empty state beats an all-zero radar. */
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

    const description = `View ${name}'s CS:GO surf statistics, records, rankings, and completions on ${SITE_NAME}.`;

    return {
      title: `${name} - Player Profile`,
      description,
      openGraph: {
        type: 'profile',
        siteName: SITE_NAME,
        title: `${name} - Player Profile - ${SITE_NAME}`,
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
  
  // No fallback to the raw param: the guard would then only reject ''.
  const validSteamId = validateSteamId(decodedSteamId);
  if (!validSteamId) {
    notFound();
  }

  const overview = await getPlayerOverviewFromCache(validSteamId);

  if (!overview) {
    notFound();
  }

  const [totals, steamAvatars, playtimeData, linearVsStagedRaw, activityHeatmap, tierDistribution, wrPerformanceData, mapEngagement] = await Promise.all([
    getTotalsFromCache(),
    getSteamProfilesFromCache([validSteamId]),
    getPlayerTimeOnServerFromCache(validSteamId),
    getLinearVsStagedPerTierFromCache(validSteamId),
    getActivityHeatmapFromCache(validSteamId),
    getTierDistributionFromCache(),
    getPlayerWrPerformanceFromCache(validSteamId),
    getPlayerMapEngagementFromCache(validSteamId),
  ]);

  // Ceiling from the server's map pool, falling back to the player's tiers. Above MAX_TIER (default
  // 10, ckSurf's max) is junk, e.g. a tier-69 stub map that would add dozens of empty radar axes.
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
        mapEngagement={mapEngagement}
        steamid={validSteamId}
      />
    </div>
  );
}
