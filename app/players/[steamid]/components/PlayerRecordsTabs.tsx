'use client';

import { useState, useMemo, useEffect } from 'react';
import { Map as MapIcon, Target, Layers, CheckCircle, Circle } from 'lucide-react';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import Pagination from '@/components/Pagination';
import SortIcon from '@/components/SortIcon';
import RecordSearchInput from '@/components/RecordSearchInput';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { formatTime, formatDate, sortRecords, matchesQuery, wrDiff, ITEMS_PER_PAGE, type SortDirection } from '@/lib/utils';
import { useDisplayTz } from '@/lib/ClientConfigContext';
import { validatePlayerName } from '@/lib/validators';
import TierBadge from '@/components/TierBadge';
import { ZoneGroupBadge, StageBadge } from '@/components/RecordBadges';
import { clientError } from '@/lib/client-logger';
import { getErrorMessage, isAbortError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import type { PlayerCompletionCounts } from '@/lib/player-profile-cache';

// Types for records
interface MapRecord {
  mapname: string;
  runtimepro: number;
  date: string;
  wr_time: number | null;
  player_rank: number;
  tier: number;
}

interface IncompleteMapRecord {
  mapname: string;
  tier: number | null;
  wr_time: number | null;
  mapType: 'linear' | 'staged';
}

interface BonusRecord {
  mapname: string;
  zonegroup: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface IncompleteBonusRecord {
  mapname: string;
  zonegroup: number;
  wr_time: number | null;
}

interface StageRecord {
  map: string;
  stage: number;
  runtime: number;
  date: string;
  player_rank: number;
}

interface IncompleteStageRecord {
  map: string;
  stage: number;
}

interface PlayerRecordsTabsProps {
  steamid: string;
  // Cheap authoritative completion totals from the overview query. Used for the
  // finished-status badges so Bonuses/Stages show correct counts before their
  // (lazily-fetched) section lists have loaded.
  counts: PlayerCompletionCounts;
}

// Each player-times route returns the full per-section list + the not-yet-done
// list. Held in state once fetched (state doubles as the client-side cache).
interface MapsSection {
  records: MapRecord[];
  incomplete: IncompleteMapRecord[];
}
interface BonusesSection {
  records: BonusRecord[];
  incomplete: IncompleteBonusRecord[];
}
interface StagesSection {
  records: StageRecord[];
  incomplete: IncompleteStageRecord[];
}

type TabType = 'maps' | 'bonuses' | 'stages';
type StatusFilter = 'finished' | 'incomplete';
type SortField = 'map' | 'rank' | 'time' | 'wrDiff' | 'date' | 'tier' | 'wrTime' | 'mapType';

export default function PlayerRecordsTabs({ steamid, counts }: PlayerRecordsTabsProps) {
  const displayTz = useDisplayTz();

  // Per-section data, fetched on tab activation. Null = not loaded yet.
  const [mapsData, setMapsData] = useState<MapsSection | null>(null);
  const [bonusesData, setBonusesData] = useState<BonusesSection | null>(null);
  const [stagesData, setStagesData] = useState<StagesSection | null>(null);
  const [isLoadingMaps, setIsLoadingMaps] = useState(false);
  const [isLoadingBonuses, setIsLoadingBonuses] = useState(false);
  const [isLoadingStages, setIsLoadingStages] = useState(false);
  // Only the active tab fetches, so one error slot covers all three.
  // `retryToken` re-runs the load; a failed section is never marked loaded.
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // Derived arrays default to empty until their section loads, so all the
  // client-side filter/sort/pagination below is unchanged from when these
  // arrived as props. Memoized so the empty-fallback keeps a stable reference
  // (otherwise the downstream useMemos would recompute every render).
  const maps = useMemo(() => mapsData?.records ?? [], [mapsData]);
  const incompleteMaps = useMemo(() => mapsData?.incomplete ?? [], [mapsData]);
  const bonuses = useMemo(() => bonusesData?.records ?? [], [bonusesData]);
  const incompleteBonuses = useMemo(() => bonusesData?.incomplete ?? [], [bonusesData]);
  const stages = useMemo(() => stagesData?.records ?? [], [stagesData]);
  const incompleteStages = useMemo(() => stagesData?.incomplete ?? [], [stagesData]);

  const [activeTab, setActiveTab] = useState<TabType>('maps');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('finished');
  const [pages, setPages] = useState({ maps: 1, bonuses: 1, stages: 1 });
  const [searchQueries, setSearchQueries] = useState({ maps: '', bonuses: '', stages: '' });
  const [sortField, setSortField] = useState<SortField>('map');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Fetch the active section's full list on activation. Nothing fetches on the
  // initial page render: this component only mounts once the user opens the
  // top-level Times tab (PlayerPageTabs conditionally mounts it), so a crawler
  // that renders only the default Overview never triggers these queries.
  // A loaded section stays in state, which doubles as the client cache,
  // re-selecting a tab never refetches.
  useEffect(() => {
    const alreadyLoaded =
      (activeTab === 'maps' && mapsData !== null) ||
      (activeTab === 'bonuses' && bonusesData !== null) ||
      (activeTab === 'stages' && stagesData !== null);
    if (alreadyLoaded) return;

    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Spinner on activation; request resolves asynchronously
    if (activeTab === 'maps') setIsLoadingMaps(true);
    else if (activeTab === 'bonuses') setIsLoadingBonuses(true);
    else setIsLoadingStages(true);

    void (async () => {
      setError(null);
      try {
        // Row shapes differ per tab; the two keys don't.
        const data = await fetchJson<{ records?: unknown[]; incomplete?: unknown[] }>(
          `/api/players/${encodeURIComponent(steamid)}/${activeTab}`,
          { signal: controller.signal }
        );
        const section = { records: data.records ?? [], incomplete: data.incomplete ?? [] };
        if (activeTab === 'maps') setMapsData(section as MapsSection);
        else if (activeTab === 'bonuses') setBonusesData(section as BonusesSection);
        else setStagesData(section as StagesSection);
      } catch (err: unknown) {
        if (!isAbortError(err)) {
          // Leave the section null so it isn't treated as loaded — the retry
          // below (and re-selecting the tab) fetches again.
          clientError(`[PlayerRecordsTabs] Failed to load ${activeTab}: ${getErrorMessage(err)}`);
          setError(getErrorMessage(err));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoadingMaps(false);
          setIsLoadingBonuses(false);
          setIsLoadingStages(false);
        }
      }
    })();

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, steamid, retryToken]);

  // Handle tab change
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    // Reset sort to default when changing tabs
    setSortField('map');
    setSortDirection('asc');
    // The error slot is shared across tabs; don't carry one tab's failure over.
    setError(null);
  };

  // Handle status filter change
  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter(status);
    // Reset to page 1 when changing status
    setPages((prev) => ({ ...prev, [activeTab]: 1 }));
  };

  // Handle page change
  const handlePageChange = (page: number) => {
    setPages((prev) => ({ ...prev, [activeTab]: page }));
  };

  // Handle search change
  const handleSearchChange = (value: string) => {
    setSearchQueries((prev) => ({ ...prev, [activeTab]: value }));
    // Reset to page 1 when search changes
    setPages((prev) => ({ ...prev, [activeTab]: 1 }));
  };

  // Clear search
  const clearSearch = () => {
    setSearchQueries((prev) => ({ ...prev, [activeTab]: '' }));
    setPages((prev) => ({ ...prev, [activeTab]: 1 }));
  };

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    // Reset to page 1 when sort changes
    setPages((prev) => ({ ...prev, [activeTab]: 1 }));
  };


  // Filter and sort records
  const filteredMaps = useMemo(() => {
    const query = searchQueries.maps;
    const filtered = query
      ? maps.filter((record) => matchesQuery(query, record.mapname))
      : maps;

    return sortRecords(filtered, sortDirection, (a, b) => {
      switch (sortField) {
        case 'map':
          return a.mapname.localeCompare(b.mapname);
        case 'rank':
          return a.player_rank - b.player_rank;
        case 'time':
          return a.runtimepro - b.runtimepro;
        case 'wrDiff':
          return wrDiff(a.runtimepro, a.wr_time) - wrDiff(b.runtimepro, b.wr_time);
        case 'date':
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        case 'tier':
          return a.tier - b.tier;
        default:
          return 0;
      }
    });
  }, [maps, searchQueries.maps, sortField, sortDirection]);

  const filteredBonuses = useMemo(() => {
    const query = searchQueries.bonuses;
    const filtered = query
      ? bonuses.filter((record) => matchesQuery(query, record.mapname))
      : bonuses;

    return sortRecords(filtered, sortDirection, (a, b) => {
      switch (sortField) {
        case 'map':
          return a.mapname.localeCompare(b.mapname) || a.zonegroup - b.zonegroup;
        case 'rank':
          return a.player_rank - b.player_rank;
        case 'time':
          return a.runtime - b.runtime;
        case 'date':
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        default:
          return a.mapname.localeCompare(b.mapname);
      }
    });
  }, [bonuses, searchQueries.bonuses, sortField, sortDirection]);

  const filteredStages = useMemo(() => {
    const query = searchQueries.stages;
    const filtered = query
      ? stages.filter((record) => matchesQuery(query, record.map))
      : stages;

    return sortRecords(filtered, sortDirection, (a, b) => {
      switch (sortField) {
        case 'map':
          return a.map.localeCompare(b.map) || a.stage - b.stage;
        case 'rank':
          return a.player_rank - b.player_rank;
        case 'time':
          return a.runtime - b.runtime;
        case 'date':
          return new Date(a.date).getTime() - new Date(b.date).getTime();
        default:
          return a.map.localeCompare(b.map);
      }
    });
  }, [stages, searchQueries.stages, sortField, sortDirection]);

  // Filter and sort incomplete records based on search
  const filteredIncompleteMaps = useMemo(() => {
    const query = searchQueries.maps;
    const filtered = query
      ? incompleteMaps.filter((record) => matchesQuery(query, record.mapname))
      : incompleteMaps;

    return sortRecords(filtered, sortDirection, (a, b) => {
      switch (sortField) {
        case 'map':
          return a.mapname.localeCompare(b.mapname);
        case 'tier': {
          const aTier = a.tier ?? 0;
          const bTier = b.tier ?? 0;
          return aTier - bTier;
        }
        case 'wrTime': {
          const aWR = a.wr_time ?? Infinity;
          const bWR = b.wr_time ?? Infinity;
          return aWR - bWR;
        }
        case 'mapType':
          return a.mapType.localeCompare(b.mapType);
        default:
          return a.mapname.localeCompare(b.mapname);
      }
    });
  }, [incompleteMaps, searchQueries.maps, sortField, sortDirection]);

  const filteredIncompleteBonuses = useMemo(() => {
    const query = searchQueries.bonuses;
    const filtered = query
      ? incompleteBonuses.filter((record) => matchesQuery(query, record.mapname))
      : incompleteBonuses;

    return sortRecords(
      filtered,
      sortDirection,
      (a, b) => a.mapname.localeCompare(b.mapname) || a.zonegroup - b.zonegroup
    );
  }, [incompleteBonuses, searchQueries.bonuses, sortDirection]);

  const filteredIncompleteStages = useMemo(() => {
    const query = searchQueries.stages;
    const filtered = query
      ? incompleteStages.filter((record) => matchesQuery(query, record.map))
      : incompleteStages;

    return sortRecords(
      filtered,
      sortDirection,
      (a, b) => a.map.localeCompare(b.map) || a.stage - b.stage
    );
  }, [incompleteStages, searchQueries.stages, sortDirection]);

  // Get current page data based on status filter
  const getCurrentData = () => {
    if (statusFilter === 'finished') {
      switch (activeTab) {
        case 'maps':
          return {
            records: filteredMaps,
            page: pages.maps,
            totalPages: Math.ceil(filteredMaps.length / ITEMS_PER_PAGE),
          };
        case 'bonuses':
          return {
            records: filteredBonuses,
            page: pages.bonuses,
            totalPages: Math.ceil(filteredBonuses.length / ITEMS_PER_PAGE),
          };
        case 'stages':
          return {
            records: filteredStages,
            page: pages.stages,
            totalPages: Math.ceil(filteredStages.length / ITEMS_PER_PAGE),
          };
      }
    } else {
      switch (activeTab) {
        case 'maps':
          return {
            records: filteredIncompleteMaps,
            page: pages.maps,
            totalPages: Math.ceil(filteredIncompleteMaps.length / ITEMS_PER_PAGE),
          };
        case 'bonuses':
          return {
            records: filteredIncompleteBonuses,
            page: pages.bonuses,
            totalPages: Math.ceil(filteredIncompleteBonuses.length / ITEMS_PER_PAGE),
          };
        case 'stages':
          return {
            records: filteredIncompleteStages,
            page: pages.stages,
            totalPages: Math.ceil(filteredIncompleteStages.length / ITEMS_PER_PAGE),
          };
      }
    }
  };

  const currentData = getCurrentData();
  const paginatedRecords = currentData.records.slice(
    (currentData.page - 1) * ITEMS_PER_PAGE,
    currentData.page * ITEMS_PER_PAGE
  );

  // Get color for WR diff percentage
  const getDiffColor = (percent: number | null): string => {
    if (percent === null) return 'text-text-muted';
    if (percent < 5) return 'text-emerald-400';
    if (percent < 15) return 'text-lime-400';
    if (percent < 25) return 'text-yellow-400';
    if (percent < 50) return 'text-orange-400';
    return 'text-red-400';
  };

  // Get count for current tab based on status filter
  const getTabCount = (tabId: TabType): number => {
    if (statusFilter === 'finished') {
      // Prefer the fetched list length once a section has loaded; otherwise fall
      // back to the authoritative overview counts so badges are correct before
      // the (lazily-fetched) Bonuses/Stages lists arrive.
      switch (tabId) {
        case 'maps': return mapsData ? maps.length : counts.maps;
        case 'bonuses': return bonusesData ? bonuses.length : counts.bonuses;
        case 'stages': return stagesData ? stages.length : counts.stages;
      }
    } else {
      switch (tabId) {
        case 'maps': return incompleteMaps.length;
        case 'bonuses': return incompleteBonuses.length;
        case 'stages': return incompleteStages.length;
      }
    }
  };

  const tabs = [
    { id: 'maps' as TabType, label: 'Maps', icon: MapIcon, color: 'text-blue-500' },
    { id: 'bonuses' as TabType, label: 'Bonuses', icon: Target, color: 'text-purple-500' },
    { id: 'stages' as TabType, label: 'Stages', icon: Layers, color: 'text-orange-500' },
  ];

  const statusFilters: Array<{ id: StatusFilter; label: string; count: number; icon: typeof CheckCircle }> = [
    { id: 'finished', label: 'Finished', count: activeTab === 'maps' ? (mapsData ? maps.length : counts.maps) : activeTab === 'bonuses' ? (bonusesData ? bonuses.length : counts.bonuses) : (stagesData ? stages.length : counts.stages), icon: CheckCircle },
    { id: 'incomplete', label: 'Incomplete', count: activeTab === 'maps' ? incompleteMaps.length : activeTab === 'bonuses' ? incompleteBonuses.length : incompleteStages.length, icon: Circle },
  ];

  const currentSearchQuery = searchQueries[activeTab];

  const isActiveLoading =
    (activeTab === 'maps' && isLoadingMaps) ||
    (activeTab === 'bonuses' && isLoadingBonuses) ||
    (activeTab === 'stages' && isLoadingStages);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Tab Bar */}
      <div className="flex flex-col sm:flex-row border-b border-border">
        {/* Main Tabs */}
        <div className="flex border-b sm:border-b-0 border-border overflow-x-auto min-w-0 sm:min-w-0 flex-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex-1 min-w-0 px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-center gap-1 sm:gap-2 transition-colors relative ${
                  isActive
                    ? 'bg-surface-hover text-text'
                    : 'text-text-muted hover:text-text hover:bg-surface-hover/50'
                }`}
              >
                <Icon className={`h-4 w-4 sm:h-5 sm:w-5 ${isActive ? tab.color : ''}`} />
                <span className="font-medium text-xs sm:text-sm">{tab.label}</span>
                <span className="bg-surface-active text-text-muted text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full">
                  {getTabCount(tab.id)}
                </span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500 sm:hidden" />
                )}
              </button>
            );
          })}
        </div>
        
        {/* Status Filter Sub-Tabs */}
        <div className="flex border-b sm:border-b-0 border-border sm:ml-auto">
          {statusFilters.map((filter) => {
            const Icon = filter.icon;
            const isActive = statusFilter === filter.id;
            return (
              <button
                key={filter.id}
                onClick={() => handleStatusChange(filter.id)}
                className={`px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-center gap-1 sm:gap-2 transition-colors relative ${
                  isActive
                    ? 'bg-surface-hover text-text'
                    : 'text-text-muted hover:text-text hover:bg-surface-hover/50'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-primary-500' : ''}`} />
                <span className="text-xs sm:text-sm">{filter.label}</span>
                <span className="bg-surface-active text-text-muted text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 rounded-full">
                  {filter.count}
                </span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-500 hidden sm:block" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Search Bar */}
      <div className="p-2 border-b border-border">
        <RecordSearchInput
          variant="full"
          value={currentSearchQuery}
          onChange={handleSearchChange}
          onClear={clearSearch}
          placeholder={`Search ${activeTab}...`}
        />
      </div>

      {/* Records List */}
      <div className="min-h-[400px]">
        {isActiveLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <LoadingSpinner />
            <span className="text-text-muted text-sm font-medium">Loading {activeTab}...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <span className="text-text-muted text-sm font-medium">
              Couldn&apos;t load {activeTab}: {error}
            </span>
            <button
              onClick={() => setRetryToken((t) => t + 1)}
              className="px-3 py-1.5 rounded-lg bg-surface-hover text-text text-sm font-medium hover:bg-surface-hover/70 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : paginatedRecords.length > 0 ? (
          <>
            {/* Desktop Sortable Headers - only for finished records */}
            {statusFilter === 'finished' && (
              <>
                <div className="hidden sm:flex px-6 py-2 bg-surface-hover/50 border-b border-border items-center gap-4 text-sm font-medium text-text-muted">
                  <button
                    onClick={() => handleSort('map')}
                    className="flex-1 min-w-0 flex items-center gap-1 hover:text-text transition-colors"
                  >
                    Map
                    <SortIcon field="map" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                  {activeTab === 'maps' && (
                    <button
                      onClick={() => handleSort('tier')}
                      className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                    >
                      Tier
                      <SortIcon field="tier" sortField={sortField} sortDirection={sortDirection} />
                    </button>
                  )}
                  {activeTab !== 'maps' && <div className="w-20" />}
                  <button
                    onClick={() => handleSort('rank')}
                    className="w-16 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                  >
                    Rank
                    <SortIcon field="rank" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                  <button
                    onClick={() => handleSort('time')}
                    className="w-24 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                  >
                    Time
                    <SortIcon field="time" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                  {activeTab === 'maps' && (
                    <button
                      onClick={() => handleSort('wrDiff')}
                      className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                    >
                      WR Diff
                      <SortIcon field="wrDiff" sortField={sortField} sortDirection={sortDirection} />
                    </button>
                  )}
                  {activeTab !== 'maps' && <div className="w-20" />}
                  <button
                    onClick={() => handleSort('date')}
                    className="w-24 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                  >
                    Date
                    <SortIcon field="date" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                </div>

                {/* Mobile Compact Header - only for finished records */}
                <div className="sm:hidden px-3 py-2 bg-surface-hover/50 border-b border-border flex items-center justify-between text-xs font-medium text-text-muted">
                  <button
                    onClick={() => handleSort('map')}
                    className="flex items-center gap-1 hover:text-text transition-colors"
                  >
                    Map
                    <SortIcon field="map" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                  <div className="flex items-center gap-2">
                    {activeTab === 'maps' && <button onClick={() => handleSort('tier')} className="flex items-center gap-1 hover:text-text transition-colors">Tier<SortIcon field="tier" sortField={sortField} sortDirection={sortDirection} /></button>}
                    <button onClick={() => handleSort('rank')} className="flex items-center gap-1 hover:text-text transition-colors">Rk<SortIcon field="rank" sortField={sortField} sortDirection={sortDirection} /></button>
                    <button onClick={() => handleSort('time')} className="flex items-center gap-1 hover:text-text transition-colors">Time<SortIcon field="time" sortField={sortField} sortDirection={sortDirection} /></button>
                    {activeTab === 'maps' && <button onClick={() => handleSort('wrDiff')} className="flex items-center gap-1 hover:text-text transition-colors">WR<SortIcon field="wrDiff" sortField={sortField} sortDirection={sortDirection} /></button>}
                    <button onClick={() => handleSort('date')} className="flex items-center gap-1 hover:text-text transition-colors">Date<SortIcon field="date" sortField={sortField} sortDirection={sortDirection} /></button>
                  </div>
                </div>
              </>
            )}

            {/* Header for incomplete records */}
            {statusFilter === 'incomplete' && (
              <>
                {/* Desktop Sortable Headers */}
                <div className="hidden sm:flex px-6 py-2 bg-surface-hover/50 border-b border-border items-center gap-4 text-sm font-medium text-text-muted">
                  <button
                    onClick={() => handleSort('map')}
                    className="flex-1 min-w-0 flex items-center gap-1 hover:text-text transition-colors"
                  >
                    Map
                    <SortIcon field="map" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                  {activeTab === 'maps' && (
                    <>
                      <button
                        onClick={() => handleSort('tier')}
                        className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                      >
                        Tier
                        <SortIcon field="tier" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                      <button
                        onClick={() => handleSort('mapType')}
                        className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                      >
                        Type
                        <SortIcon field="mapType" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                      <button
                        onClick={() => handleSort('wrTime')}
                        className="w-24 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                      >
                        WR
                        <SortIcon field="wrTime" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </>
                  )}
                  {activeTab !== 'maps' && <><div className="w-20" /><div className="w-20" /><div className="w-24" /></>}
                </div>

                {/* Mobile Compact Header */}
                <div className="sm:hidden px-3 py-2 bg-surface-hover/50 border-b border-border flex items-center justify-between text-xs font-medium text-text-muted">
                  <button
                    onClick={() => handleSort('map')}
                    className="flex items-center gap-1 hover:text-text transition-colors"
                  >
                    Map
                    <SortIcon field="map" sortField={sortField} sortDirection={sortDirection} />
                  </button>
                  {activeTab === 'maps' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleSort('tier')} className="flex items-center gap-1 hover:text-text transition-colors">
                        Tier<SortIcon field="tier" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                      <button onClick={() => handleSort('mapType')} className="flex items-center gap-1 hover:text-text transition-colors">
                        Type<SortIcon field="mapType" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                      <button onClick={() => handleSort('wrTime')} className="flex items-center gap-1 hover:text-text transition-colors">
                        WR<SortIcon field="wrTime" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="divide-y divide-border">
              {/* FINISHED RECORDS */}
              {statusFilter === 'finished' && activeTab === 'maps' &&
                (paginatedRecords as MapRecord[]).map((record, i) => {
                  const wrTimeDiff = record.wr_time ? record.runtimepro - record.wr_time : null;
                  const wrPercent = record.wr_time
                    ? Math.min(100, ((record.runtimepro - record.wr_time) / record.wr_time) * 100)
                    : null;

                  return (
                    <div
                      key={`${record.mapname}-${i}`}
                      className="px-2 sm:px-4 py-2 hover:bg-surface-hover/50 transition-colors flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <MapLinkWithPreview mapname={record.mapname}>
                          {validatePlayerName(record.mapname)}
                        </MapLinkWithPreview>
                      </div>
                      <div className="sm:w-20 flex justify-end">
                        <TierBadge tier={record.tier} />
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm">
                        <div className="sm:w-16 text-left sm:text-right">
                          <span className="sm:hidden text-text-muted mr-1">Rk:</span>
                          <span className="text-text-muted">#{record.player_rank}</span>
                        </div>
                        <div className="sm:w-24 text-left sm:text-right font-mono text-text">
                          {formatTime(record.runtimepro)}
                        </div>
                        {wrTimeDiff !== null && wrTimeDiff > 0 && (
                          <div className="sm:w-20 text-left sm:text-right">
                            <span className={`font-mono ${getDiffColor(wrPercent)}`}>
                              +{formatTime(wrTimeDiff)}
                            </span>
                          </div>
                        )}
                        {(!wrTimeDiff || wrTimeDiff <= 0) && <div className="sm:w-20 hidden sm:block" />}
                        <div className="sm:w-24 text-left sm:text-right text-text-muted">
                          {formatDate(record.date, displayTz)}
                        </div>
                      </div>
                    </div>
                  );
                })}

              {statusFilter === 'finished' && activeTab === 'bonuses' &&
                (paginatedRecords as BonusRecord[]).map((record, i) => (
                  <div
                    key={`${record.mapname}-${record.zonegroup}-${i}`}
                    className="px-2 sm:px-4 py-2 hover:bg-surface-hover/50 transition-colors flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <MapLinkWithPreview mapname={record.mapname}>
                        {validatePlayerName(record.mapname)}
                      </MapLinkWithPreview>
                      <ZoneGroupBadge zonegroup={record.zonegroup} />
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm">
                      <div className="sm:w-16 text-left sm:text-right">
                        <span className="sm:hidden text-text-muted mr-1">Rk:</span>
                        <span className="text-text-muted">#{record.player_rank}</span>
                      </div>
                      <div className="sm:w-24 text-left sm:text-right font-mono text-text">
                        {formatTime(record.runtime)}
                      </div>
                      <div className="sm:w-20 hidden sm:block" />
                      <div className="sm:w-24 text-left sm:text-right text-text-muted">
                        {formatDate(record.date, displayTz)}
                      </div>
                    </div>
                  </div>
                ))}

              {statusFilter === 'finished' && activeTab === 'stages' &&
                (paginatedRecords as StageRecord[]).map((record, i) => (
                  <div
                    key={`${record.map}-${record.stage}-${i}`}
                    className="px-2 sm:px-4 py-2 hover:bg-surface-hover/50 transition-colors flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <MapLinkWithPreview mapname={record.map}>
                        {validatePlayerName(record.map)}
                      </MapLinkWithPreview>
                      <StageBadge stage={record.stage} />
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 text-xs sm:text-sm">
                      <div className="sm:w-16 text-left sm:text-right">
                        <span className="sm:hidden text-text-muted mr-1">Rk:</span>
                        <span className="text-text-muted">#{record.player_rank}</span>
                      </div>
                      <div className="sm:w-24 text-left sm:text-right font-mono text-text">
                        {formatTime(record.runtime)}
                      </div>
                      <div className="sm:w-20 hidden sm:block" />
                      <div className="sm:w-24 text-left sm:text-right text-text-muted">
                        {formatDate(record.date, displayTz)}
                      </div>
                    </div>
                  </div>
                ))}

              {/* INCOMPLETE RECORDS */}
              {statusFilter === 'incomplete' && activeTab === 'maps' &&
                (paginatedRecords as IncompleteMapRecord[]).map((record, i) => (
                  <div
                    key={`${record.mapname}-${i}`}
                    className="px-2 sm:px-4 py-2 hover:bg-surface-hover/50 transition-colors flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <MapLinkWithPreview mapname={record.mapname}>
                        {validatePlayerName(record.mapname)}
                      </MapLinkWithPreview>
                    </div>
                    <div className="flex items-center gap-4 sm:gap-4">
                      <div className="sm:w-20 sm:text-right sm:flex sm:items-center sm:justify-end">
                        {record.tier !== null && (
                          <TierBadge tier={record.tier} />
                        )}
                      </div>
                      <div className="sm:w-20 sm:text-right sm:flex sm:items-center sm:justify-end">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          record.mapType === 'staged'
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-blue-500/20 text-blue-400'
                        }`}>
                          {record.mapType === 'staged' ? 'Staged' : 'Linear'}
                        </span>
                      </div>
                      <div className="sm:w-24 sm:text-right sm:flex sm:items-center sm:justify-end">
                        {record.wr_time && (
                          <span className="font-mono text-text-muted">
                            {formatTime(record.wr_time)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

              {statusFilter === 'incomplete' && activeTab === 'bonuses' &&
                (paginatedRecords as IncompleteBonusRecord[]).map((record, i) => (
                  <div
                    key={`${record.mapname}-${record.zonegroup}-${i}`}
                    className="px-2 sm:px-4 py-2 hover:bg-surface-hover/50 transition-colors flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <MapLinkWithPreview mapname={record.mapname}>
                        {validatePlayerName(record.mapname)}
                      </MapLinkWithPreview>
                      <ZoneGroupBadge zonegroup={record.zonegroup} />
                    </div>
                    <div className="flex items-center gap-4 sm:gap-4">
                      <div className="sm:w-20" />
                      <div className="sm:w-24 sm:text-right sm:flex sm:items-center sm:justify-end">
                        {record.wr_time && (
                          <span className="font-mono text-text-muted">
                            {formatTime(record.wr_time)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

              {statusFilter === 'incomplete' && activeTab === 'stages' &&
                (paginatedRecords as IncompleteStageRecord[]).map((record, i) => (
                  <div
                    key={`${record.map}-${record.stage}-${i}`}
                    className="px-2 sm:px-4 py-2 hover:bg-surface-hover/50 transition-colors flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3"
                  >
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <MapLinkWithPreview mapname={record.map}>
                        {validatePlayerName(record.map)}
                      </MapLinkWithPreview>
                      <StageBadge stage={record.stage} />
                    </div>
                    <div className="sm:w-20" />
                    <div className="sm:w-16" />
                    <div className="sm:w-24" />
                    <div className="sm:w-20" />
                    <div className="sm:w-24" />
                  </div>
                ))}
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-text-muted">
            <p>No {activeTab} found</p>
            <p className="text-sm mt-1">
              {statusFilter === 'finished'
                ? 'No finished records for this player.'
                : 'No incomplete records for this player.'}
            </p>
            {currentSearchQuery && (
              <p className="text-sm mt-1">
                No {activeTab} matching &ldquo;{currentSearchQuery}&rdquo;.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {currentData.totalPages > 1 && (
        <div className="px-3 sm:px-6 py-4 border-t border-border">
          <Pagination
            currentPage={currentData.page}
            totalPages={currentData.totalPages}
            onPageChange={handlePageChange}
          />
        </div>
      )}
    </div>
  );
}