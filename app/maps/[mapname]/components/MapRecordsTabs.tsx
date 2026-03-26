'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Trophy, Target, Layers, Search, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';
import Link from 'next/link';
import ClientPagination from '@/app/players/[steamid]/components/ClientPagination';
import { formatTime, formatDate } from '@/lib/utils';
import { sanitizePlayerName } from '@/lib/sanitize';

interface MapRecord {
  steamid: string;
  name: string;
  runtimepro: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface BonusRecord {
  steamid: string;
  name: string;
  zonegroup: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface StageRecord {
  steamid: string;
  name: string;
  stage: number;
  runtime: number;
  date: string;
  rank: number;
  wr_time: number | null;
  startspeed: number;
}

interface MapRecordsTabsProps {
  records: MapRecord[];
  totalRecords: number;
  bonusRecords: BonusRecord[];
  stageRecords: StageRecord[];
  mapname: string;
  numBonuses: number;
  numStages: number;
  wr_time: number | null;
}

type TabType = 'map' | 'bonus' | 'stages';

const ITEMS_PER_PAGE = 20;

// Sort types
type SortField = 'rank' | 'player' | 'time' | 'speed' | 'wrDiff' | 'date';
type SortDirection = 'asc' | 'desc';

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Format time difference from WR
function formatTimeDiff(time: number, wrTime: number | null): string {
  if (!wrTime || time === wrTime) return '-';
  const diff = time - wrTime;
  return `+${formatTime(diff)}`;
}

export default function MapRecordsTabs({
  records,
  totalRecords,
  bonusRecords,
  stageRecords,
  mapname,
  numBonuses,
  numStages,
  wr_time,
}: MapRecordsTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State for loading additional records from API
  const [allLeaderboardRecords, setAllLeaderboardRecords] = useState<MapRecord[]>(records);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadedPage, setLoadedPage] = useState(Math.ceil(records.length / ITEMS_PER_PAGE));
  const [hasMoreToLoad, setHasMoreToLoad] = useState(totalRecords > records.length);
  // Ref to track loaded pages as a Set (for arbitrary page navigation)
  const loadedPagesRef = useRef<Set<number>>(new Set());

  // State for stages loaded via API
  const [allStageRecords, setAllStageRecords] = useState<StageRecord[]>([]);
  const [stagesList, setStagesList] = useState<number[]>([]);
  const [totalStageRecords, setTotalStageRecords] = useState(0);
  const [isLoadingStages, setIsLoadingStages] = useState(false);

  // State for bonuses loaded via API
  const [allBonusRecords, setAllBonusRecords] = useState<BonusRecord[]>([]);
  const [bonusGroupsList, setBonusGroupsList] = useState<number[]>([]);
  const [totalBonusRecords, setTotalBonusRecords] = useState(0);
  const [isLoadingBonuses, setIsLoadingBonuses] = useState(false);

  // Reset state when map changes - only depends on mapname to avoid pagination issues
  useEffect(() => {
    setAllLeaderboardRecords(records);
    const initialLoadedPage = Math.ceil(records.length / ITEMS_PER_PAGE);
    setLoadedPage(initialLoadedPage);
    // Initialize loadedPages Set with initial pages from server-rendered records
    loadedPagesRef.current = new Set();
    for (let i = 1; i <= initialLoadedPage; i++) {
      loadedPagesRef.current.add(i);
    }
    setHasMoreToLoad(totalRecords > records.length);
    setLeaderboardPage(1);
    setAllStageRecords([]);
    setAllBonusRecords([]);
    setTotalStageRecords(0);
    setTotalBonusRecords(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapname]);

  // Get initial state from URL
  const initialTab = (searchParams.get('tab') as TabType) || 'map';
  const initialPage = parseInt(searchParams.get('page') || '1', 10);
  const initialBonus = parseInt(searchParams.get('bonus') || '1', 10);
  const initialBonusPage = parseInt(searchParams.get('bonusPage') || '1', 10);
  const initialStage = parseInt(searchParams.get('stage') || '1', 10);
  const initialStagePage = parseInt(searchParams.get('stagePage') || '1', 10);
  const initialSearch = searchParams.get('q') || '';
  const initialBonusSearch = searchParams.get('bq') || '';
  const initialStageSearch = searchParams.get('sq') || '';
  const initialSortField = (searchParams.get('sort') as SortField) || 'rank';
  const initialSortDir = (searchParams.get('dir') as SortDirection) || 'asc';

  // State
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [leaderboardPage, setLeaderboardPage] = useState(initialPage);
  const [selectedBonus, setSelectedBonus] = useState(initialBonus);
  const [bonusPage, setBonusPage] = useState(initialBonusPage);
  const [selectedStage, setSelectedStage] = useState(initialStage);
  const [stagePage, setStagePage] = useState(initialStagePage);
  const [searchQuery, setSearchQuery] = useState(initialSearch);
  const [bonusSearchQuery, setBonusSearchQuery] = useState(initialBonusSearch);
  const [stageSearchQuery, setStageSearchQuery] = useState(initialStageSearch);
  const [sortField, setSortField] = useState<SortField>(initialSortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDir);

  // Debounced search for URL updates
  const debouncedSearch = useDebounce(searchQuery, 300);
  const debouncedBonusSearch = useDebounce(bonusSearchQuery, 300);
  const debouncedStageSearch = useDebounce(stageSearchQuery, 300);

  // Group bonus records by zonegroup - uses API-loaded records
  const bonusGroups = useMemo(() => {
    const groups: { [zonegroup: number]: BonusRecord[] } = {};
    for (const record of allBonusRecords) {
      if (!groups[record.zonegroup]) {
        groups[record.zonegroup] = [];
      }
      groups[record.zonegroup].push(record);
    }
    // Sort records within each group by rank
    for (const zonegroup in groups) {
      groups[parseInt(zonegroup)].sort((a, b) => a.rank - b.rank);
    }
    return groups;
  }, [allBonusRecords]);

  // Group stage records by stage - uses API-loaded records
  const stageGroups = useMemo(() => {
    const groups: { [stage: number]: StageRecord[] } = {};
    for (const record of allStageRecords) {
      if (!groups[record.stage]) {
        groups[record.stage] = [];
      }
      groups[record.stage].push(record);
    }
    // Sort records within each group by rank
    for (const stage in groups) {
      groups[parseInt(stage)].sort((a, b) => a.rank - b.rank);
    }
    return groups;
  }, [allStageRecords]);

  // Function to load more records from API (sequential loading)
  const loadMoreRecords = async () => {
    if (isLoadingMore || !hasMoreToLoad) return;
    
    setIsLoadingMore(true);
    try {
      // Find the next page to load (first page not in loadedPages Set)
      let nextPage = 1;
      while (loadedPagesRef.current.has(nextPage)) {
        nextPage++;
      }
      const response = await fetch(`/api/maps/${mapname}/records?page=${nextPage}&pageSize=${ITEMS_PER_PAGE}`);
      const data = await response.json();
      
      if (data.records && data.records.length > 0) {
        // Merge with existing records, ensuring we don't have duplicates
        setAllLeaderboardRecords(prev => {
          const existingIds = new Set(prev.map(r => r.steamid + r.date));
          const newRecords = data.records.filter((r: MapRecord) =>
            !existingIds.has(r.steamid + r.date)
          );
          return [...prev, ...newRecords];
        });
        loadedPagesRef.current.add(nextPage);
        setLoadedPage(nextPage);
        setHasMoreToLoad(data.pagination.page < data.pagination.totalPages);
      } else {
        setHasMoreToLoad(false);
      }
    } catch (error) {
      console.error('Failed to load more records:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Function to load stage records from API
  const loadStageRecords = async (stage: number, page: number = 1) => {
    if (isLoadingStages) return;

    setIsLoadingStages(true);
    try {
      const response = await fetch(`/api/maps/${mapname}/stages?stage=${stage}&page=${page}&pageSize=${ITEMS_PER_PAGE}`);
      const data = await response.json();

      if (data.stages && data.stages.length > 0) {
        setAllStageRecords(data.stages);
        setTotalStageRecords(data.pagination.total);
        if (data.stagesList && data.stagesList.length > 0) {
          setStagesList(data.stagesList);
        }
      } else {
        setAllStageRecords([]);
        setTotalStageRecords(0);
      }
    } catch (error) {
      console.error('Failed to load stage records:', error);
    } finally {
      setIsLoadingStages(false);
    }
  };

  // Load stage records when selected stage changes
  useEffect(() => {
    if (activeTab === 'stages' && numStages > 1) {
      loadStageRecords(selectedStage, stagePage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedStage, stagePage, numStages]);

  // Function to load bonus records from API
  const loadBonusRecords = async (bonus: number, page: number = 1) => {
    if (isLoadingBonuses) return;

    setIsLoadingBonuses(true);
    try {
      const response = await fetch(`/api/maps/${mapname}/bonuses?bonus=${bonus}&page=${page}&pageSize=${ITEMS_PER_PAGE}`);
      const data = await response.json();

      if (data.bonuses && data.bonuses.length > 0) {
        setAllBonusRecords(data.bonuses);
        setTotalBonusRecords(data.pagination.total);
        if (data.bonusGroupsList && data.bonusGroupsList.length > 0) {
          setBonusGroupsList(data.bonusGroupsList);
        }
      } else {
        setAllBonusRecords([]);
        setTotalBonusRecords(0);
      }
    } catch (error) {
      console.error('Failed to load bonus records:', error);
    } finally {
      setIsLoadingBonuses(false);
    }
  };

  // Load bonus records when selected bonus changes
  useEffect(() => {
    if (activeTab === 'bonus' && numBonuses > 0) {
      loadBonusRecords(selectedBonus, bonusPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedBonus, bonusPage, numBonuses]);

  // Current bonus records based on selected bonus
  const currentBonusRecords = useMemo(() => {
    return bonusGroups[selectedBonus] || [];
  }, [bonusGroups, selectedBonus]);

  // Current stage records based on selected stage
  const currentStageRecords = useMemo(() => {
    return stageGroups[selectedStage] || [];
  }, [stageGroups, selectedStage]);

  // Update URL when state changes
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tab', activeTab);
    params.set('page', leaderboardPage.toString());
    params.set('bonus', selectedBonus.toString());
    params.set('bonusPage', bonusPage.toString());
    params.set('stage', selectedStage.toString());
    params.set('stagePage', stagePage.toString());
    if (searchQuery) params.set('q', searchQuery);
    if (bonusSearchQuery) params.set('bq', bonusSearchQuery);
    if (stageSearchQuery) params.set('sq', stageSearchQuery);
    if (sortField !== 'rank') params.set('sort', sortField);
    if (sortDirection !== 'asc') params.set('dir', sortDirection);

    router.replace(`?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, leaderboardPage, selectedBonus, bonusPage, selectedStage, stagePage, debouncedSearch, debouncedBonusSearch, debouncedStageSearch, sortField, sortDirection, router]);

  // Handle tab change
  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    // Reset sort to default when changing tabs
    setSortField('rank');
    setSortDirection('asc');
  };

  // Handle page change - with auto-loading for map tab
  const handlePageChange = async (page: number) => {
    if (activeTab === 'map') {
      // Check if this page has already been loaded
      if (!loadedPagesRef.current.has(page)) {
        try {
          const response = await fetch(`/api/maps/${mapname}/records?page=${page}&pageSize=${ITEMS_PER_PAGE}`);
          const data = await response.json();
          
          if (data.records && data.records.length > 0) {
            // Merge with existing records, ensuring we don't have duplicates
            setAllLeaderboardRecords(prev => {
              const existingIds = new Set(prev.map(r => r.steamid + r.date));
              const newRecords = data.records.filter((r: MapRecord) =>
                !existingIds.has(r.steamid + r.date)
              );
              return [...prev, ...newRecords];
            });
            loadedPagesRef.current.add(page);
            setLoadedPage(page);
            setHasMoreToLoad(data.pagination.page < data.pagination.totalPages);
          }
        } catch (error) {
          console.error('Failed to load records:', error);
        }
      }
      setLeaderboardPage(page);
    } else if (activeTab === 'bonus') {
      setBonusPage(page);
    } else {
      setStagePage(page);
    }
  };

  // Handle search change
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setLeaderboardPage(1);
  };

  // Handle bonus search change
  const handleBonusSearchChange = (value: string) => {
    setBonusSearchQuery(value);
    setBonusPage(1);
  };

  // Handle stage search change
  const handleStageSearchChange = (value: string) => {
    setStageSearchQuery(value);
    setStagePage(1);
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setLeaderboardPage(1);
  };

  // Clear bonus search
  const clearBonusSearch = () => {
    setBonusSearchQuery('');
    setBonusPage(1);
  };

  // Clear stage search
  const clearStageSearch = () => {
    setStageSearchQuery('');
    setStagePage(1);
  };

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setLeaderboardPage(1);
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

  // Filter records by search - use all loaded records (not just initial batch)
  const filteredRecords = useMemo(() => {
    if (!debouncedSearch) return allLeaderboardRecords;
    const query = debouncedSearch.toLowerCase();
    return allLeaderboardRecords.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.steamid.toLowerCase().includes(query)
    );
  }, [allLeaderboardRecords, debouncedSearch]);

  // Sort records
  const sortedRecords = useMemo(() => {
    const sorted = [...filteredRecords];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'rank':
          comparison = a.rank - b.rank;
          break;
        case 'player':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'time':
          comparison = a.runtimepro - b.runtimepro;
          break;
        case 'speed':
          comparison = a.startspeed - b.startspeed;
          break;
        case 'wrDiff':
          const aDiff = a.wr_time ? a.runtimepro - a.wr_time : Infinity;
          const bDiff = b.wr_time ? b.runtimepro - b.wr_time : Infinity;
          comparison = aDiff - bDiff;
          break;
        case 'date':
          comparison = new Date(b.date).getTime() - new Date(a.date).getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredRecords, sortField, sortDirection]);

  // Paginated records
  const totalPages = Math.ceil((searchQuery ? sortedRecords.length : totalRecords) / ITEMS_PER_PAGE);
  
  // Calculate rank range for the requested page (not array indices, since pages may be loaded non-sequentially)
  const startRank = (leaderboardPage - 1) * ITEMS_PER_PAGE + 1;
  const endRank = leaderboardPage * ITEMS_PER_PAGE;
  
  // Filter records by rank range instead of array slice
  const paginatedRecords = sortedRecords.filter(
    (r) => r.rank >= startRank && r.rank <= endRank
  );

  // Filter bonus records by search
  const filteredBonusRecords = useMemo(() => {
    if (!debouncedBonusSearch) return allBonusRecords;
    const query = debouncedBonusSearch.toLowerCase();
    return allBonusRecords.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.steamid.toLowerCase().includes(query)
    );
  }, [allBonusRecords, debouncedBonusSearch]);

  // Sort bonus records
  const sortedBonusRecords = useMemo(() => {
    const sorted = [...filteredBonusRecords];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'rank':
          comparison = a.rank - b.rank;
          break;
        case 'player':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'time':
          comparison = a.runtime - b.runtime;
          break;
        case 'speed':
          comparison = a.startspeed - b.startspeed;
          break;
        case 'wrDiff':
          const aDiff = a.wr_time ? a.runtime - a.wr_time : Infinity;
          const bDiff = b.wr_time ? b.runtime - b.wr_time : Infinity;
          comparison = aDiff - bDiff;
          break;
        case 'date':
          comparison = new Date(b.date).getTime() - new Date(a.date).getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredBonusRecords, sortField, sortDirection]);

  // Paginated bonus records - use rank-based filtering for non-sequential page loading
  const totalBonusPages = Math.ceil((bonusSearchQuery ? sortedBonusRecords.length : totalBonusRecords) / ITEMS_PER_PAGE);
  const bonusStartRank = (bonusPage - 1) * ITEMS_PER_PAGE + 1;
  const bonusEndRank = bonusPage * ITEMS_PER_PAGE;
  const paginatedBonusRecords = sortedBonusRecords.filter(
    (r) => r.rank >= bonusStartRank && r.rank <= bonusEndRank
  );

  // Filter stage records by search
  const filteredStageRecords = useMemo(() => {
    if (!debouncedStageSearch) return allStageRecords;
    const query = debouncedStageSearch.toLowerCase();
    return allStageRecords.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.steamid.toLowerCase().includes(query)
    );
  }, [allStageRecords, debouncedStageSearch]);

  // Sort stage records
  const sortedStageRecords = useMemo(() => {
    const sorted = [...filteredStageRecords];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'rank':
          comparison = a.rank - b.rank;
          break;
        case 'player':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'time':
          comparison = a.runtime - b.runtime;
          break;
        case 'speed':
          comparison = a.startspeed - b.startspeed;
          break;
        case 'wrDiff':
          const aDiff = a.wr_time ? a.runtime - a.wr_time : Infinity;
          const bDiff = b.wr_time ? b.runtime - b.wr_time : Infinity;
          comparison = aDiff - bDiff;
          break;
        case 'date':
          comparison = new Date(b.date).getTime() - new Date(a.date).getTime();
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredStageRecords, sortField, sortDirection]);

  // Paginated stage records - use rank-based filtering for non-sequential page loading
  const totalStagePages = Math.ceil((stageSearchQuery ? sortedStageRecords.length : totalStageRecords) / ITEMS_PER_PAGE);
  const stageStartRank = (stagePage - 1) * ITEMS_PER_PAGE + 1;
  const stageEndRank = stagePage * ITEMS_PER_PAGE;
  const paginatedStageRecords = sortedStageRecords.filter(
    (r) => r.rank >= stageStartRank && r.rank <= stageEndRank
  );

  // Get the base URL for pagination
  const getBaseUrl = () => {
    const params = new URLSearchParams();
    params.set('tab', activeTab);
    if (searchQuery && activeTab === 'map') params.set('q', searchQuery);
    if (bonusSearchQuery && activeTab === 'bonus') params.set('bq', bonusSearchQuery);
    if (stageSearchQuery && activeTab === 'stages') params.set('sq', stageSearchQuery);
    if (selectedBonus > 1 && activeTab === 'bonus') params.set('bonus', selectedBonus.toString());
    if (selectedStage > 1 && activeTab === 'stages') params.set('stage', selectedStage.toString());
    return `/maps/${mapname}?${params.toString()}`;
  };

  // Render record row for Map tab
  const renderRecordRow = (record: MapRecord) => (
    <tr
      key={record.steamid}
      className="hover:bg-surface-hover/50 transition-colors"
    >
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${
            record.rank === 1
              ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
              : record.rank === 2
              ? 'bg-zinc-300/20 text-zinc-300 border border-zinc-300/30'
              : record.rank === 3
              ? 'bg-amber-700/20 text-amber-600 border border-amber-700/30'
              : 'text-text-placeholder'
          }`}
        >
          {record.rank}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <Link
          href={`/players/${record.steamid}`}
          className="text-primary hover:text-primary font-medium transition-colors text-base"
          prefetch={false}
        >
          {sanitizePlayerName(record.name)}
        </Link>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className="font-mono text-lg font-medium text-text">
          {formatTime(record.runtimepro)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className={`font-mono text-lg font-medium ${
          record.rank === 1 ? 'text-green-400' : 'text-yellow-400'
        }`}>
          {formatTimeDiff(record.runtimepro, record.wr_time)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        {record.startspeed !== -1 ? (
          <span className="font-mono text-lg font-medium text-text">
            {record.startspeed.toFixed(1)}
          </span>
        ) : (
          <span className="text-text-muted">-</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-text-muted">
        {formatDate(record.date)}
      </td>
    </tr>
  );

  // Render bonus/stage record row
  const renderCompletionRow = (record: BonusRecord | StageRecord, _timeKey: 'runtime') => (
    <tr
      key={`${record.steamid}-${'zonegroup' in record ? record.zonegroup : record.stage}`}
      className="hover:bg-surface-hover/50 transition-colors"
    >
      <td className="px-6 py-4 whitespace-nowrap">
        <span
          className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${
            record.rank === 1
              ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
              : record.rank === 2
              ? 'bg-zinc-300/20 text-zinc-300 border border-zinc-300/30'
              : record.rank === 3
              ? 'bg-amber-700/20 text-amber-600 border border-amber-700/30'
              : 'text-text-placeholder'
          }`}
        >
          {record.rank}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap">
        <Link
          href={`/players/${record.steamid}`}
          className="text-primary hover:text-primary font-medium transition-colors text-base"
          prefetch={false}
        >
          {sanitizePlayerName(record.name)}
        </Link>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className="font-mono text-lg font-medium text-text">
          {formatTime(record.runtime)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        <span className={`font-mono text-lg font-medium ${
          record.rank === 1 ? 'text-green-400' : 'text-yellow-400'
        }`}>
          {formatTimeDiff(record.runtime, record.wr_time)}
        </span>
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right">
        {record.startspeed !== -1 ? (
          <span className="font-mono text-lg font-medium text-text">
            {record.startspeed.toFixed(1)}
          </span>
        ) : (
          <span className="text-text-muted">-</span>
        )}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-text-muted">
        {formatDate(record.date)}
      </td>
    </tr>
  );

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="px-6 py-4 border-b border-border bg-surface/50">
        <div className="flex flex-wrap items-center gap-4">
          {/* Tab buttons */}
          <div className="flex gap-1">
            <button
              onClick={() => handleTabChange('map')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                activeTab === 'map'
                  ? 'bg-primary-600 text-white'
                  : 'bg-surface-hover text-text-muted hover:bg-surface-hover/70 hover:text-text'
              }`}
            >
              <Trophy className="h-4 w-4" />
              Map
            </button>
            {numBonuses > 0 && (
              <button
                onClick={() => handleTabChange('bonus')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  activeTab === 'bonus'
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-hover text-text-muted hover:bg-surface-hover/70 hover:text-text'
                }`}
              >
                <Target className="h-4 w-4" />
                Bonus
              </button>
            )}
            {numStages > 1 && (
              <button
                onClick={() => handleTabChange('stages')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  activeTab === 'stages'
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-hover text-text-muted hover:bg-surface-hover/70 hover:text-text'
                }`}
              >
                <Layers className="h-4 w-4" />
                Stages
              </button>
            )}
          </div>

          {/* Search for Map tab */}
          {activeTab === 'map' && (
            <div className="relative flex-1 max-w-xs">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-text-placeholder" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="block w-full pl-10 pr-8 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
                placeholder="Search players..."
              />
              {searchQuery && (
                <button
                  onClick={clearSearch}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-placeholder hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Search for Bonus tab */}
          {activeTab === 'bonus' && (
            <div className="relative flex-1 max-w-xs">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-text-placeholder" />
              </div>
              <input
                type="text"
                value={bonusSearchQuery}
                onChange={(e) => handleBonusSearchChange(e.target.value)}
                className="block w-full pl-10 pr-8 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
                placeholder="Search players..."
              />
              {bonusSearchQuery && (
                <button
                  onClick={clearBonusSearch}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-placeholder hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Search for Stages tab */}
          {activeTab === 'stages' && (
            <div className="relative flex-1 max-w-xs">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-text-placeholder" />
              </div>
              <input
                type="text"
                value={stageSearchQuery}
                onChange={(e) => handleStageSearchChange(e.target.value)}
                className="block w-full pl-10 pr-8 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
                placeholder="Search players..."
              />
              {stageSearchQuery && (
                <button
                  onClick={clearStageSearch}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-text-placeholder hover:text-text"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Bonus sub-tabs */}
        {activeTab === 'bonus' && numBonuses > 0 && (
          <div className="flex gap-2 mt-4 flex-wrap">
            {Array.from({ length: numBonuses }, (_, i) => i + 1).map((bonusNum) => (
              <button
                key={bonusNum}
                onClick={() => {
                  setSelectedBonus(bonusNum);
                  setBonusPage(1);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedBonus === bonusNum
                    ? 'bg-purple-600 text-white'
                    : 'bg-surface-hover text-text-muted hover:bg-surface-hover/70 hover:text-text'
                }`}
              >
                Bonus {bonusNum}
              </button>
            ))}
          </div>
        )}

        {/* Stage sub-tabs */}
        {activeTab === 'stages' && numStages > 1 && (
          <div className="flex gap-2 mt-4 flex-wrap">
            {Array.from({ length: numStages }, (_, i) => i + 1).map((stageNum) => (
              <button
                key={stageNum}
                onClick={() => {
                  setSelectedStage(stageNum);
                  setStagePage(1);
                }}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedStage === stageNum
                    ? 'bg-orange-600 text-white'
                    : 'bg-surface-hover text-text-muted hover:bg-surface-hover/70 hover:text-text'
                }`}
              >
                Stage {stageNum}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Map Tab */}
      {activeTab === 'map' && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface/50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-24 cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center gap-2">
                      Rank
                      <SortIcon field="rank" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('player')}
                  >
                    <div className="flex items-center gap-2">
                      Player
                      <SortIcon field="player" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('time')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Time
                      <SortIcon field="time" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('wrDiff')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Diff
                      <SortIcon field="wrDiff" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('speed')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Start Speed
                      <SortIcon field="speed" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('date')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Date
                      <SortIcon field="date" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-border">
                {paginatedRecords.map(renderRecordRow)}
                {paginatedRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-12 text-center text-text-muted"
                    >
                      {debouncedSearch
                        ? 'No players found matching your search.'
                        : 'No completions yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-6 border-t border-border">
              <ClientPagination
                currentPage={leaderboardPage}
                totalPages={totalPages}
                onPageChange={(page) => handlePageChange(page)}
              />
            </div>
          )}
        </>
      )}

      {/* Bonus Tab */}
      {activeTab === 'bonus' && numBonuses > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface/50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-24 cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center gap-2">
                      Rank
                      <SortIcon field="rank" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('player')}
                  >
                    <div className="flex items-center gap-2">
                      Player
                      <SortIcon field="player" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('time')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Time
                      <SortIcon field="time" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('wrDiff')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Diff
                      <SortIcon field="wrDiff" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('speed')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Start Speed
                      <SortIcon field="speed" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('date')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Date
                      <SortIcon field="date" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-border">
                {paginatedBonusRecords.map((record) => renderCompletionRow(record, 'runtime'))}
                {paginatedBonusRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-12 text-center text-text-muted"
                    >
                      {debouncedBonusSearch
                        ? 'No players found matching your search.'
                        : `No bonus completions for Bonus ${selectedBonus}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalBonusPages > 1 && (
            <div className="px-6 border-t border-border">
              <ClientPagination
                currentPage={bonusPage}
                totalPages={totalBonusPages}
                onPageChange={(page) => handlePageChange(page)}
              />
            </div>
          )}
        </>
      )}

      {/* Stages Tab */}
      {activeTab === 'stages' && numStages > 1 && (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-surface/50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider w-24 cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('rank')}
                  >
                    <div className="flex items-center gap-2">
                      Rank
                      <SortIcon field="rank" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('player')}
                  >
                    <div className="flex items-center gap-2">
                      Player
                      <SortIcon field="player" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('time')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Time
                      <SortIcon field="time" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('wrDiff')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Diff
                      <SortIcon field="wrDiff" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('speed')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Start Speed
                      <SortIcon field="speed" />
                    </div>
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-hover/50 transition-colors"
                    onClick={() => handleSort('date')}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Date
                      <SortIcon field="date" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-surface divide-y divide-border">
                {paginatedStageRecords.map((record) => renderCompletionRow(record, 'runtime'))}
                {paginatedStageRecords.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-6 py-12 text-center text-text-muted"
                    >
                      {debouncedStageSearch
                        ? 'No players found matching your search.'
                        : `No stage completions for Stage ${selectedStage}.`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalStagePages > 1 && (
            <div className="px-6 border-t border-border">
              <ClientPagination
                currentPage={stagePage}
                totalPages={totalStagePages}
                onPageChange={(page) => handlePageChange(page)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
