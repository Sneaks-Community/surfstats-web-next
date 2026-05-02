'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Map as MapIcon, Target, Layers, Search, X, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle, Circle } from 'lucide-react';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import Pagination from '@/components/Pagination';
import { formatTime, formatDate } from '@/lib/utils';
import { validatePlayerName } from '@/lib/validators';
import TierBadge from '@/components/TierBadge';
import { useDebounce } from '@/hooks/useDebounce';

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
  maps: MapRecord[];
  bonuses: BonusRecord[];
  stages: StageRecord[];
  incompleteMaps: IncompleteMapRecord[];
  incompleteBonuses: IncompleteBonusRecord[];
  incompleteStages: IncompleteStageRecord[];
  steamid: string;
}

type TabType = 'maps' | 'bonuses' | 'stages';
type StatusFilter = 'finished' | 'incomplete';
type SortField = 'map' | 'rank' | 'time' | 'wrDiff' | 'date' | 'tier' | 'wrTime' | 'mapType';
type SortDirection = 'asc' | 'desc';

const ITEMS_PER_PAGE = 20;

export default function PlayerRecordsTabs({
  maps,
  bonuses,
  stages,
  incompleteMaps,
  incompleteBonuses,
  incompleteStages,
}: PlayerRecordsTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get initial state from URL
  const initialTab = (searchParams.get('tab') as TabType) || 'maps';
  const initialStatus = (searchParams.get('status') as StatusFilter) || 'finished';
  const initialMapPage = parseInt(searchParams.get('mapPage') || '1', 10);
  const initialBonusPage = parseInt(searchParams.get('bonusPage') || '1', 10);
  const initialStagePage = parseInt(searchParams.get('stagePage') || '1', 10);
  const initialMapSearch = searchParams.get('mapSearch') || '';
  const initialBonusSearch = searchParams.get('bonusSearch') || '';
  const initialStageSearch = searchParams.get('stageSearch') || '';
  const initialSortField = (searchParams.get('sort') as SortField) || 'map';
  const initialSortDir = (searchParams.get('dir') as SortDirection) || 'asc';

  // State
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [pages, setPages] = useState({
    maps: initialMapPage,
    bonuses: initialBonusPage,
    stages: initialStagePage,
  });
  const [searchQueries, setSearchQueries] = useState({
    maps: initialMapSearch,
    bonuses: initialBonusSearch,
    stages: initialStageSearch,
  });
  const [sortField, setSortField] = useState<SortField>(initialSortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDir);

  // Debounced search for URL updates
  const debouncedSearch = useDebounce(searchQueries[activeTab], 300);

  // Update URL when state changes
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tab', activeTab);
    params.set('status', statusFilter);
    params.set('mapPage', pages.maps.toString());
    params.set('bonusPage', pages.bonuses.toString());
    params.set('stagePage', pages.stages.toString());
    if (searchQueries.maps) params.set('mapSearch', searchQueries.maps);
    if (searchQueries.bonuses) params.set('bonusSearch', searchQueries.bonuses);
    if (searchQueries.stages) params.set('stageSearch', searchQueries.stages);
    if (sortField !== 'map') params.set('sort', sortField);
    if (sortDirection !== 'asc') params.set('dir', sortDirection);

    router.replace(`?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, statusFilter, pages.maps, pages.bonuses, pages.stages, debouncedSearch, sortField, sortDirection, router]);

  // Handle tab change
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    // Reset sort to default when changing tabs
    setSortField('map');
    setSortDirection('asc');
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

  // Sort icon component
  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 text-text-muted opacity-50" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="h-4 w-4 text-primary-500" />
    ) : (
      <ArrowDown className="h-4 w-4 text-primary-500" />
    );
  };

  // Filter and sort records
  const filteredMaps = useMemo(() => {
    const query = searchQueries.maps.toLowerCase();
    let filtered = maps;
    if (query) {
      filtered = maps.filter((record) => record.mapname.toLowerCase().includes(query));
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'map':
          comparison = a.mapname.localeCompare(b.mapname);
          break;
        case 'rank':
          comparison = a.player_rank - b.player_rank;
          break;
        case 'time':
          comparison = a.runtimepro - b.runtimepro;
          break;
        case 'wrDiff':
          const aDiff = a.wr_time ? a.runtimepro - a.wr_time : Infinity;
          const bDiff = b.wr_time ? b.runtimepro - b.wr_time : Infinity;
          comparison = aDiff - bDiff;
          break;
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'tier':
          comparison = a.tier - b.tier;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [maps, searchQueries.maps, sortField, sortDirection]);

  const filteredBonuses = useMemo(() => {
    const query = searchQueries.bonuses.toLowerCase();
    let filtered = bonuses;
    if (query) {
      filtered = bonuses.filter((record) => record.mapname.toLowerCase().includes(query));
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'map':
          comparison = a.mapname.localeCompare(b.mapname) || a.zonegroup - b.zonegroup;
          break;
        case 'rank':
          comparison = a.player_rank - b.player_rank;
          break;
        case 'time':
          comparison = a.runtime - b.runtime;
          break;
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        default:
          comparison = a.mapname.localeCompare(b.mapname);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [bonuses, searchQueries.bonuses, sortField, sortDirection]);

  const filteredStages = useMemo(() => {
    const query = searchQueries.stages.toLowerCase();
    let filtered = stages;
    if (query) {
      filtered = stages.filter((record) => record.map.toLowerCase().includes(query));
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'map':
          comparison = a.map.localeCompare(b.map) || a.stage - b.stage;
          break;
        case 'rank':
          comparison = a.player_rank - b.player_rank;
          break;
        case 'time':
          comparison = a.runtime - b.runtime;
          break;
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        default:
          comparison = a.map.localeCompare(b.map);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [stages, searchQueries.stages, sortField, sortDirection]);

  // Filter and sort incomplete records based on search
  const filteredIncompleteMaps = useMemo(() => {
    const query = searchQueries.maps.toLowerCase();
    let filtered = incompleteMaps;
    if (query) {
      filtered = incompleteMaps.filter((record) => record.mapname.toLowerCase().includes(query));
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'map':
          comparison = a.mapname.localeCompare(b.mapname);
          break;
        case 'tier':
          const aTier = a.tier ?? 0;
          const bTier = b.tier ?? 0;
          comparison = aTier - bTier;
          break;
        case 'wrTime':
          const aWR = a.wr_time ?? Infinity;
          const bWR = b.wr_time ?? Infinity;
          comparison = aWR - bWR;
          break;
        case 'mapType':
          comparison = a.mapType.localeCompare(b.mapType);
          break;
        default:
          comparison = a.mapname.localeCompare(b.mapname);
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [incompleteMaps, searchQueries.maps, sortField, sortDirection]);

  const filteredIncompleteBonuses = useMemo(() => {
    const query = searchQueries.bonuses.toLowerCase();
    let filtered = incompleteBonuses;
    if (query) {
      filtered = incompleteBonuses.filter((record) => record.mapname.toLowerCase().includes(query));
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'map':
          comparison = a.mapname.localeCompare(b.mapname) || a.zonegroup - b.zonegroup;
          break;
        default:
          comparison = a.mapname.localeCompare(b.mapname) || a.zonegroup - b.zonegroup;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [incompleteBonuses, searchQueries.bonuses, sortField, sortDirection]);

  const filteredIncompleteStages = useMemo(() => {
    const query = searchQueries.stages.toLowerCase();
    let filtered = incompleteStages;
    if (query) {
      filtered = incompleteStages.filter((record) => record.map.toLowerCase().includes(query));
    }
    
    // Sort
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'map':
          comparison = a.map.localeCompare(b.map) || a.stage - b.stage;
          break;
        default:
          comparison = a.map.localeCompare(b.map) || a.stage - b.stage;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [incompleteStages, searchQueries.stages, sortField, sortDirection]);

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
      switch (tabId) {
        case 'maps': return maps.length;
        case 'bonuses': return bonuses.length;
        case 'stages': return stages.length;
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
    { id: 'finished', label: 'Finished', count: activeTab === 'maps' ? maps.length : activeTab === 'bonuses' ? bonuses.length : stages.length, icon: CheckCircle },
    { id: 'incomplete', label: 'Incomplete', count: activeTab === 'maps' ? incompleteMaps.length : activeTab === 'bonuses' ? incompleteBonuses.length : incompleteStages.length, icon: Circle },
  ];

  const currentSearchQuery = searchQueries[activeTab];

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
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted" />
          <input
            type="text"
            value={currentSearchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className="w-full pl-10 pr-10 py-2 bg-surface-hover border border-border rounded-lg text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {currentSearchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-active transition-colors"
            >
              <X className="h-4 w-4 text-text-muted" />
            </button>
          )}
        </div>
      </div>

      {/* Records List */}
      <div className="min-h-[400px]">
        {paginatedRecords.length > 0 ? (
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
                    <SortIcon field="map" />
                  </button>
                  {activeTab === 'maps' && (
                    <button
                      onClick={() => handleSort('tier')}
                      className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                    >
                      Tier
                      <SortIcon field="tier" />
                    </button>
                  )}
                  {activeTab !== 'maps' && <div className="w-20" />}
                  <button
                    onClick={() => handleSort('rank')}
                    className="w-16 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                  >
                    Rank
                    <SortIcon field="rank" />
                  </button>
                  <button
                    onClick={() => handleSort('time')}
                    className="w-24 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                  >
                    Time
                    <SortIcon field="time" />
                  </button>
                  {activeTab === 'maps' && (
                    <button
                      onClick={() => handleSort('wrDiff')}
                      className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                    >
                      WR Diff
                      <SortIcon field="wrDiff" />
                    </button>
                  )}
                  {activeTab !== 'maps' && <div className="w-20" />}
                  <button
                    onClick={() => handleSort('date')}
                    className="w-24 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                  >
                    Date
                    <SortIcon field="date" />
                  </button>
                </div>

                {/* Mobile Compact Header - only for finished records */}
                <div className="sm:hidden px-3 py-2 bg-surface-hover/50 border-b border-border flex items-center justify-between text-xs font-medium text-text-muted">
                  <button
                    onClick={() => handleSort('map')}
                    className="flex items-center gap-1 hover:text-text transition-colors"
                  >
                    Map
                    <SortIcon field="map" />
                  </button>
                  <div className="flex items-center gap-2">
                    {activeTab === 'maps' && <button onClick={() => handleSort('tier')} className="flex items-center gap-1 hover:text-text transition-colors">Tier<SortIcon field="tier" /></button>}
                    <button onClick={() => handleSort('rank')} className="flex items-center gap-1 hover:text-text transition-colors">Rk<SortIcon field="rank" /></button>
                    <button onClick={() => handleSort('time')} className="flex items-center gap-1 hover:text-text transition-colors">Time<SortIcon field="time" /></button>
                    {activeTab === 'maps' && <button onClick={() => handleSort('wrDiff')} className="flex items-center gap-1 hover:text-text transition-colors">WR<SortIcon field="wrDiff" /></button>}
                    <button onClick={() => handleSort('date')} className="flex items-center gap-1 hover:text-text transition-colors">Date<SortIcon field="date" /></button>
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
                    <SortIcon field="map" />
                  </button>
                  {activeTab === 'maps' && (
                    <>
                      <button
                        onClick={() => handleSort('tier')}
                        className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                      >
                        Tier
                        <SortIcon field="tier" />
                      </button>
                      <button
                        onClick={() => handleSort('mapType')}
                        className="w-20 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                      >
                        Type
                        <SortIcon field="mapType" />
                      </button>
                      <button
                        onClick={() => handleSort('wrTime')}
                        className="w-24 text-right flex items-center justify-end gap-1 hover:text-text transition-colors"
                      >
                        WR
                        <SortIcon field="wrTime" />
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
                    <SortIcon field="map" />
                  </button>
                  {activeTab === 'maps' && (
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleSort('tier')} className="flex items-center gap-1 hover:text-text transition-colors">
                        Tier<SortIcon field="tier" />
                      </button>
                      <button onClick={() => handleSort('mapType')} className="flex items-center gap-1 hover:text-text transition-colors">
                        Type<SortIcon field="mapType" />
                      </button>
                      <button onClick={() => handleSort('wrTime')} className="flex items-center gap-1 hover:text-text transition-colors">
                        WR<SortIcon field="wrTime" />
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
                          {formatDate(record.date)}
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
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">
                        B{record.zonegroup}
                      </span>
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
                        {formatDate(record.date)}
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
                      <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
                        S{record.stage}
                      </span>
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
                        {formatDate(record.date)}
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
                      <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">
                        B{record.zonegroup}
                      </span>
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
                      <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
                        S{record.stage}
                      </span>
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