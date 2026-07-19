'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Trophy, Target, Layers } from 'lucide-react';
import Link from 'next/link';
import Pagination from '@/components/Pagination';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import SortableTh from '@/components/SortableTh';
import RecordSearchInput from '@/components/RecordSearchInput';
import { formatTime, formatDate, sortRecords, matchesQuery, parseIntParam, type SortDirection } from '@/lib/utils';
import { validatePlayerName } from '@/lib/validators';
import { useDebounce } from '@/hooks/useDebounce';
import { clientError } from '@/lib/client-logger';
import { getErrorMessage, isAbortError } from '@/lib/errors';

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
  mapname: string;
  numBonuses: number;
  numStages: number;
}

type TabType = 'map' | 'bonus' | 'stages';

const ITEMS_PER_PAGE = 20;
const MAX_STAGE_RECORDS = 100;

// Sort types
type SortField = 'rank' | 'player' | 'time' | 'speed' | 'wrDiff' | 'date';

// Shared leaderboard header row for the map, bonus, and stages tables — the
// three tabs render identical columns and differ only in the sort handler.
const LeaderboardHeaderRow = ({
  onSort,
  sortField,
  sortDirection,
}: {
  onSort: (field: SortField) => void;
  sortField: SortField;
  sortDirection: SortDirection;
}) => (
  <thead className="bg-surface/50">
    <tr>
      <SortableTh label="Rank" field="rank" className="w-24" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
      <SortableTh label="Player" field="player" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
      <SortableTh label="Time" field="time" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
      <SortableTh label="Diff" field="wrDiff" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
      <SortableTh label="Start Speed" field="speed" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
      <SortableTh label="Date" field="date" align="right" onSort={onSort} sortField={sortField} sortDirection={sortDirection} />
    </tr>
  </thead>
);

// Format time difference from WR
function formatTimeDiff(time: number, wrTime: number | null): string {
  if (!wrTime || time === wrTime) return '-';
  const diff = time - wrTime;
  return `+${formatTime(diff)}`;
}

// Rank badge - medal styling for the top 3, muted otherwise
const RankBadge = ({ rank }: { rank: number }) => (
  <span
    className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-bold text-sm ${
      rank === 1
        ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
        : rank === 2
        ? 'bg-zinc-300/20 text-zinc-300 border border-zinc-300/30'
        : rank === 3
        ? 'bg-amber-700/20 text-amber-600 border border-amber-700/30'
        : 'text-text-placeholder'
    }`}
  >
    {rank}
  </span>
);

// Shared record row for the map, bonus, and stages tables (caller supplies the key)
const RecordRow = ({
  rank,
  steamid,
  name,
  time,
  wr_time,
  startspeed,
  date,
}: {
  rank: number;
  steamid: string;
  name: string;
  time: number;
  wr_time: number | null;
  startspeed: number;
  date: string;
}) => (
  <tr className="hover:bg-surface-hover/50 transition-colors">
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
      <RankBadge rank={rank} />
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap">
      <Link
        href={`/players/${steamid}`}
        className="text-primary hover:text-primary font-medium transition-colors text-base"
        prefetch={false}
      >
        {validatePlayerName(name)}
      </Link>
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right">
      <span className="font-mono text-lg font-medium text-text">
        {formatTime(time)}
      </span>
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right">
      <span className={`font-mono text-lg font-medium ${
        rank === 1 ? 'text-green-400' : 'text-yellow-400'
      }`}>
        {formatTimeDiff(time, wr_time)}
      </span>
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right">
      {startspeed !== -1 ? (
        <span className="font-mono text-lg font-medium text-text">
          {startspeed.toFixed(1)}
        </span>
      ) : (
        <span className="text-text-muted">-</span>
      )}
    </td>
    <td className="px-2 sm:px-4 py-2 whitespace-nowrap text-right text-sm text-text-muted">
      {formatDate(date)}
    </td>
  </tr>
);

export default function MapRecordsTabs({
  records,
  totalRecords,
  mapname,
  numBonuses,
  numStages,
}: MapRecordsTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // State for loading additional records from API
  const [allLeaderboardRecords, setAllLeaderboardRecords] = useState<MapRecord[]>(records);
  // Ref to track loaded pages as a Set (for arbitrary page navigation)
  const loadedPagesRef = useRef<Set<number>>(new Set());

  // Ref to track fetched bonus-page combinations for client-side caching
  // Key format: "${bonus}-${page}"
  const bonusCacheRef = useRef<Map<string, BonusRecord[]>>(new Map());

  // State for stages loaded via API
  const [allStageRecords, setAllStageRecords] = useState<StageRecord[]>([]);
  const [totalStageRecords, setTotalStageRecords] = useState(0);
  const [isLoadingStages, setIsLoadingStages] = useState(false);

  // State for bonuses loaded via API
  const [allBonusRecords, setAllBonusRecords] = useState<BonusRecord[]>([]);
  const [totalBonusRecords, setTotalBonusRecords] = useState(0);
  const [isLoadingBonuses, setIsLoadingBonuses] = useState(false);

  const allLeaderboardLoadedRef = useRef<boolean>(totalRecords <= records.length);
  const [isLoadingAllLeaderboard, setIsLoadingAllLeaderboard] = useState(false);
  const allBonusLoadedRef = useRef<Set<number>>(new Set());
  const [isLoadingAllBonus, setIsLoadingAllBonus] = useState(false);

  // Server-side search state — map tab
  const [searchApiResults, setSearchApiResults] = useState<MapRecord[]>([]);
  const [isSearchingApi, setIsSearchingApi] = useState(false);
  const [searchApiPage, setSearchApiPage] = useState(1);

  // Server-side search state — bonus tab
  const [bonusSearchApiResults, setBonusSearchApiResults] = useState<BonusRecord[]>([]);
  const [isBonusSearchingApi, setIsBonusSearchingApi] = useState(false);
  const [bonusSearchApiPage, setBonusSearchApiPage] = useState(1);

  // Server-side search state — stages tab
  const [stageSearchApiResults, setStageSearchApiResults] = useState<StageRecord[]>([]);
  const [isStageSearchingApi, setIsStageSearchingApi] = useState(false);
  const [stageSearchApiPage, setStageSearchApiPage] = useState(1);

  // Reset state when map changes - only depends on mapname to avoid pagination issues
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Syncing state with incoming records prop on map change
    setAllLeaderboardRecords(records);
    const initialLoadedPage = Math.ceil(records.length / ITEMS_PER_PAGE);
    // Initialize loadedPages Set with initial pages from server-rendered records
    loadedPagesRef.current = new Set();
    for (let i = 1; i <= initialLoadedPage; i++) {
      loadedPagesRef.current.add(i);
    }
    allLeaderboardLoadedRef.current = totalRecords <= records.length;
    allBonusLoadedRef.current = new Set();
    // eslint-disable-next-line react-hooks/immutability -- useState setters are stable across renders
    setLeaderboardPage(1);
    // Clear bonus cache when map changes
    bonusCacheRef.current = new Map();
    setAllStageRecords([]);
    setAllBonusRecords([]);
    setTotalStageRecords(0);
    setTotalBonusRecords(0);
    // Clear server-side search state
    setSearchApiResults([]);
    setIsSearchingApi(false);
    setSearchApiPage(1);
    setBonusSearchApiResults([]);
    setIsBonusSearchingApi(false);
    setBonusSearchApiPage(1);
    setStageSearchApiResults([]);
    setIsStageSearchingApi(false);
    setStageSearchApiPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapname]);

  // Get initial state from URL
  const initialTab = (searchParams.get('tab') as TabType | null) ?? 'map';
  const initialPage = parseIntParam(searchParams.get('page'));
  const initialBonus = parseIntParam(searchParams.get('bonus'));
  const initialBonusPage = parseIntParam(searchParams.get('bonusPage'));
  const initialStage = parseIntParam(searchParams.get('stage'));
  const initialStagePage = parseIntParam(searchParams.get('stagePage'));
  const initialSearch = searchParams.get('q') ?? '';
  const initialBonusSearch = searchParams.get('bq') ?? '';
  const initialStageSearch = searchParams.get('sq') ?? '';
  const initialSortField = (searchParams.get('sort') as SortField | null) ?? 'rank';
  const initialSortDir = (searchParams.get('dir') as SortDirection | null) ?? 'asc';

  // State - Map tab uses client-side sorting, Stages tab uses server-side sorting
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

  // 400 ms debounce for all API-backed searches (map, bonus, and stages tabs)
  const debouncedSearch = useDebounce(searchQuery, 400);
  const debouncedBonusSearch = useDebounce(bonusSearchQuery, 400);
  const debouncedStageSearch = useDebounce(stageSearchQuery, 400);

  // Function to load stage records from API - returns all 100 records for client-side pagination
  const MAX_STAGE_PAGES = Math.ceil(MAX_STAGE_RECORDS / ITEMS_PER_PAGE);

  const loadStageRecords = async (stage: number) => {
    if (isLoadingStages) return;

    setIsLoadingStages(true);
    try {
      // Build query - API returns all 100 records sorted by rank
      const params = new URLSearchParams();
      params.set('stage', stage.toString());

      const response = await fetch(`/api/maps/${mapname}/stages?${params.toString()}`);
      const data = await response.json();

      if (data.stages && data.stages.length > 0) {
        setAllStageRecords(data.stages);
        setTotalStageRecords(data.pagination.total);
      } else {
        setAllStageRecords([]);
        setTotalStageRecords(0);
      }
    } catch (error) {
      clientError(`Failed to load stage records: ${getErrorMessage(error)}`);
      setAllStageRecords([]);
      setTotalStageRecords(0);
    } finally {
      setIsLoadingStages(false);
    }
  };

  // Load stage records when selected stage changes (sort is handled client-side)
  useEffect(() => {
    if (activeTab === 'stages' && numStages > 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Triggering data load on tab/stage change
      void loadStageRecords(selectedStage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedStage, numStages]);

  // Function to load bonus records from API with client-side caching
  const loadBonusRecords = async (bonus: number, page = 1) => {
    if (isLoadingBonuses) return;

    // Check client-side cache first
    const cacheKey = `${bonus}-${page}`;
    const cachedData = bonusCacheRef.current.get(cacheKey);
    
    if (cachedData) {
      // Cache hit - use cached data
      setAllBonusRecords(cachedData);
      setIsLoadingBonuses(false);
      return;
    }

    setIsLoadingBonuses(true);
    try {
      const response = await fetch(`/api/maps/${mapname}/bonuses?bonus=${bonus}&page=${page}&pageSize=${ITEMS_PER_PAGE}`);
      const data = await response.json();

      if (data.bonuses && data.bonuses.length > 0) {
        // Store in client-side cache
        bonusCacheRef.current.set(cacheKey, data.bonuses);
        // This is a single rank-window page — the full set is no longer loaded.
        allBonusLoadedRef.current.delete(bonus);
        setAllBonusRecords(data.bonuses);
        setTotalBonusRecords(data.pagination.total);
      } else {
        bonusCacheRef.current.set(cacheKey, []);
        setAllBonusRecords([]);
        setTotalBonusRecords(0);
      }
    } catch (error) {
      clientError(`Failed to load bonus records: ${getErrorMessage(error)}`);
      bonusCacheRef.current.set(cacheKey, []);
      setAllBonusRecords([]);
      setTotalBonusRecords(0);
    } finally {
      setIsLoadingBonuses(false);
    }
  };

  // Load bonus records when selected bonus changes.
  // Skip while a non-rank sort is active — that uses the load-all path below,
  // which needs the full set rather than a single rank-window page.
  useEffect(() => {
    if (activeTab === 'bonus' && numBonuses > 0) {
      if (sortField !== 'rank') return;
      void loadBonusRecords(selectedBonus, bonusPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedBonus, bonusPage, numBonuses, sortField]);

  // When a non-rank sort is active on the map tab, load the full
  // leaderboard once so pagination pages through the globally-sorted order.
  useEffect(() => {
    if (activeTab !== 'map') return;
    if (sortField === 'rank') return;
    if (searchQuery.length >= 3) return;
    if (allLeaderboardLoadedRef.current) return;

    const controller = new AbortController();
    void (async () => {
      setIsLoadingAllLeaderboard(true);
      try {
        const LOAD_PAGE_SIZE = 100;
        const apiPages = Math.max(1, Math.ceil(totalRecords / LOAD_PAGE_SIZE));
        const merged = new Map<string, MapRecord>();
        for (let p = 1; p <= apiPages; p++) {
          const response = await fetch(`/api/maps/${mapname}/records?page=${p}&pageSize=${LOAD_PAGE_SIZE}`, { signal: controller.signal });
          const data = await response.json();
          if (Array.isArray(data.records)) {
            for (const r of data.records as MapRecord[]) merged.set(r.steamid + r.date, r);
          }
        }
        setAllLeaderboardRecords(Array.from(merged.values()));
        allLeaderboardLoadedRef.current = true;
      } catch (error) {
        if (!isAbortError(error)) clientError(`Failed to load all records for sorting: ${getErrorMessage(error)}`);
      } finally {
        if (!controller.signal.aborted) setIsLoadingAllLeaderboard(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, sortField, searchQuery, mapname, totalRecords]);

  // same load-all path for the bonus tab (per-bonus).
  useEffect(() => {
    if (activeTab !== 'bonus') return;
    if (sortField === 'rank') return;
    if (bonusSearchQuery.length >= 3) return;
    if (allBonusLoadedRef.current.has(selectedBonus)) return;

    const controller = new AbortController();
    void (async () => {
      setIsLoadingAllBonus(true);
      try {
        const LOAD_PAGE_SIZE = 100;
        const merged = new Map<string, BonusRecord>();
        let total = Infinity;
        for (let p = 1; (p - 1) * LOAD_PAGE_SIZE < total; p++) {
          const response = await fetch(`/api/maps/${mapname}/bonuses?bonus=${selectedBonus}&page=${p}&pageSize=${LOAD_PAGE_SIZE}`, { signal: controller.signal });
          const data = await response.json();
          total = data.pagination?.total ?? 0;
          if (Array.isArray(data.bonuses) && data.bonuses.length > 0) {
            for (const r of data.bonuses as BonusRecord[]) merged.set(`${r.steamid}-${r.zonegroup}`, r);
          } else {
            break;
          }
        }
        setAllBonusRecords(Array.from(merged.values()));
        setTotalBonusRecords(merged.size);
        allBonusLoadedRef.current.add(selectedBonus);
      } catch (error) {
        if (!isAbortError(error)) clientError(`Failed to load all bonus records for sorting: ${getErrorMessage(error)}`);
      } finally {
        if (!controller.signal.aborted) setIsLoadingAllBonus(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, sortField, bonusSearchQuery, selectedBonus, mapname]);

  // Server-side search — map tab
  // Fires after 400 ms of silence; only when query is ≥ 3 characters
  useEffect(() => {
    if (debouncedSearch.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clearing stale results when query drops below threshold
      setSearchApiResults([]);
      setIsSearchingApi(false);
      return;
    }
    const controller = new AbortController();
    setIsSearchingApi(true);
    fetch(`/api/maps/${mapname}/records?q=${encodeURIComponent(debouncedSearch)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        setSearchApiResults(data.records ?? []);
        setSearchApiPage(1);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          clientError(`[MapRecordsTabs] Search failed: ${getErrorMessage(err)}`);
          setSearchApiResults([]);
        }
      })
      .finally(() => setIsSearchingApi(false));
    return () => controller.abort();
  }, [debouncedSearch, mapname]);

  // Server-side search — bonus tab
  useEffect(() => {
    if (debouncedBonusSearch.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clearing stale results when query drops below threshold
      setBonusSearchApiResults([]);
      setIsBonusSearchingApi(false);
      return;
    }
    const controller = new AbortController();
    setIsBonusSearchingApi(true);
    fetch(
      `/api/maps/${mapname}/bonuses?bonus=${selectedBonus}&q=${encodeURIComponent(debouncedBonusSearch)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((data) => {
        setBonusSearchApiResults(data.records ?? []);
        setBonusSearchApiPage(1);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          clientError(`[MapRecordsTabs] Bonus search failed: ${getErrorMessage(err)}`);
          setBonusSearchApiResults([]);
        }
      })
      .finally(() => setIsBonusSearchingApi(false));
    return () => controller.abort();
  }, [debouncedBonusSearch, mapname, selectedBonus]);

  // Server-side search — stages tab
  useEffect(() => {
    if (debouncedStageSearch.length < 3) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clearing stale results when query drops below threshold
      setStageSearchApiResults([]);
      setIsStageSearchingApi(false);
      return;
    }
    const controller = new AbortController();
    setIsStageSearchingApi(true);
    fetch(
      `/api/maps/${mapname}/stages?stage=${selectedStage}&q=${encodeURIComponent(debouncedStageSearch)}`,
      { signal: controller.signal }
    )
      .then((r) => r.json())
      .then((data) => {
        setStageSearchApiResults(data.stages ?? []);
        setStageSearchApiPage(1);
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          clientError(`[MapRecordsTabs] Stage search failed: ${getErrorMessage(err)}`);
          setStageSearchApiResults([]);
        }
      })
      .finally(() => setIsStageSearchingApi(false));
    return () => controller.abort();
  }, [debouncedStageSearch, mapname, selectedStage]);

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
    // Sort state is shared across tabs and always written as sort/dir so it
    // round-trips through the URL initializer above (which only reads `dir`).
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
      // Full set already loaded (non-rank sort path) — just change the page.
      if (allLeaderboardLoadedRef.current) {
        setLeaderboardPage(page);
        return;
      }
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
          }
        } catch (error) {
          clientError(`Failed to load records: ${getErrorMessage(error)}`);
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
    setSearchApiPage(1);
    if (value.length >= 3) {
      // Show spinner immediately; the debounced effect fires the actual request after 400 ms
      setIsSearchingApi(true);
    } else {
      setIsSearchingApi(false);
      setSearchApiResults([]);
    }
  };

  // Handle bonus search change
  const handleBonusSearchChange = (value: string) => {
    setBonusSearchQuery(value);
    setBonusPage(1);
    setBonusSearchApiPage(1);
    if (value.length >= 3) {
      setIsBonusSearchingApi(true);
    } else {
      setIsBonusSearchingApi(false);
      setBonusSearchApiResults([]);
    }
  };

  // Handle stage search change
  const handleStageSearchChange = (value: string) => {
    setStageSearchQuery(value);
    setStagePage(1);
    setStageSearchApiPage(1);
    if (value.length >= 3) {
      setIsStageSearchingApi(true);
    } else {
      setIsStageSearchingApi(false);
      setStageSearchApiResults([]);
    }
  };

  // Clear search
  const clearSearch = () => {
    setSearchQuery('');
    setLeaderboardPage(1);
    setSearchApiResults([]);
    setIsSearchingApi(false);
    setSearchApiPage(1);
  };

  // Clear bonus search
  const clearBonusSearch = () => {
    setBonusSearchQuery('');
    setBonusPage(1);
    setBonusSearchApiResults([]);
    setIsBonusSearchingApi(false);
    setBonusSearchApiPage(1);
  };

  // Clear stage search
  const clearStageSearch = () => {
    setStageSearchQuery('');
    setStagePage(1);
    setStageSearchApiResults([]);
    setIsStageSearchingApi(false);
    setStageSearchApiPage(1);
  };

  // Handle sort for the map and bonus tabs (client-side sorting)
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    // Reset to the first page — under a non-rank sort the pages follow the
    // sorted order, so a stale high page could fall outside the result set.
    setLeaderboardPage(1);
    setBonusPage(1);
  };

  // Handle sort for stages tab (server-side sorting)
  const handleStageSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setStagePage(1);
  };


  // Filter records by search - use all loaded records (not just initial batch)
  const filteredRecords = useMemo(() => {
    if (!debouncedSearch) return allLeaderboardRecords;
    return allLeaderboardRecords.filter((r) =>
      matchesQuery(debouncedSearch, r.name, r.steamid)
    );
  }, [allLeaderboardRecords, debouncedSearch]);

  // Sort records
  const sortedRecords = useMemo(
    () =>
      sortRecords(filteredRecords, sortDirection, (a, b) => {
        switch (sortField) {
          case 'player':
            return a.name.localeCompare(b.name);
          case 'time':
            return a.runtimepro - b.runtimepro;
          case 'speed': {
            // -1 = no speed data; push to the end like the wrDiff sentinel.
            const aSpeed = a.startspeed === -1 ? Infinity : a.startspeed;
            const bSpeed = b.startspeed === -1 ? Infinity : b.startspeed;
            return aSpeed - bSpeed;
          }
          case 'wrDiff': {
            const aDiff = a.wr_time ? a.runtimepro - a.wr_time : Infinity;
            const bDiff = b.wr_time ? b.runtimepro - b.wr_time : Infinity;
            return aDiff - bDiff;
          }
          case 'date':
            return new Date(b.date).getTime() - new Date(a.date).getTime();
          default:
            return a.rank - b.rank;
        }
      }),
    [filteredRecords, sortField, sortDirection]
  );

  // Paginated records
  // Search mode (≥3 chars): paginate over server-returned results — every match is reachable.
  // Rank sort: rank-window filtering handles non-sequential lazy page loading.
  // Non-rank sort: the full set is loaded (see load-all effect), so slice the
  //   globally-sorted array — pages follow the sorted order, not the rank window.
  const inSearchMode = searchQuery.length >= 3;
  const searchApiStart = (searchApiPage - 1) * ITEMS_PER_PAGE;
  const leaderboardStart = (leaderboardPage - 1) * ITEMS_PER_PAGE;
  const leaderboardEnd = leaderboardPage * ITEMS_PER_PAGE;
  const totalPages = inSearchMode
    ? Math.ceil(searchApiResults.length / ITEMS_PER_PAGE)
    : Math.ceil(totalRecords / ITEMS_PER_PAGE);
  const paginatedRecords = inSearchMode
    ? searchApiResults.slice(searchApiStart, searchApiStart + ITEMS_PER_PAGE)
    : sortField === 'rank'
      ? sortedRecords.filter((r) => r.rank >= leaderboardStart + 1 && r.rank <= leaderboardEnd)
      : sortedRecords.slice(leaderboardStart, leaderboardStart + ITEMS_PER_PAGE);

  // Filter bonus records by search
  const filteredBonusRecords = useMemo(() => {
    if (!debouncedBonusSearch) return allBonusRecords;
    return allBonusRecords.filter((r) =>
      matchesQuery(debouncedBonusSearch, r.name, r.steamid)
    );
  }, [allBonusRecords, debouncedBonusSearch]);

  // Sort bonus records
  const sortedBonusRecords = useMemo(
    () =>
      sortRecords(filteredBonusRecords, sortDirection, (a, b) => {
        switch (sortField) {
          case 'player':
            return a.name.localeCompare(b.name);
          case 'time':
            return a.runtime - b.runtime;
          case 'speed': {
            // -1 = no speed data; push to the end like the wrDiff sentinel.
            const aSpeed = a.startspeed === -1 ? Infinity : a.startspeed;
            const bSpeed = b.startspeed === -1 ? Infinity : b.startspeed;
            return aSpeed - bSpeed;
          }
          case 'wrDiff': {
            const aDiff = a.wr_time ? a.runtime - a.wr_time : Infinity;
            const bDiff = b.wr_time ? b.runtime - b.wr_time : Infinity;
            return aDiff - bDiff;
          }
          case 'date':
            return new Date(b.date).getTime() - new Date(a.date).getTime();
          default:
            return a.rank - b.rank;
        }
      }),
    [filteredBonusRecords, sortField, sortDirection]
  );

  // Paginated bonus records — same pattern as map tab above.
  const inBonusSearchMode = bonusSearchQuery.length >= 3;
  const bonusSearchApiStart = (bonusSearchApiPage - 1) * ITEMS_PER_PAGE;
  const bonusStart = (bonusPage - 1) * ITEMS_PER_PAGE;
  const bonusEnd = bonusPage * ITEMS_PER_PAGE;
  const totalBonusPages = inBonusSearchMode
    ? Math.ceil(bonusSearchApiResults.length / ITEMS_PER_PAGE)
    : Math.ceil(totalBonusRecords / ITEMS_PER_PAGE);
  const paginatedBonusRecords = inBonusSearchMode
    ? bonusSearchApiResults.slice(bonusSearchApiStart, bonusSearchApiStart + ITEMS_PER_PAGE)
    : sortField === 'rank'
      ? sortedBonusRecords.filter((r) => r.rank >= bonusStart + 1 && r.rank <= bonusEnd)
      : sortedBonusRecords.slice(bonusStart, bonusStart + ITEMS_PER_PAGE);

  // Stage records are sorted by rank (runtime ASC) from the server
  // We sort client-side based on the selected sort field
  const sortedStageRecords = useMemo(
    () =>
      sortRecords(allStageRecords, sortDirection, (a, b) => {
        switch (sortField) {
          case 'rank':
          case 'time':
            return a.runtime - b.runtime;
          case 'player':
            return a.name.localeCompare(b.name);
          case 'speed': {
            // -1 = no speed data; push to the end like the wrDiff sentinel.
            const aSpeed = a.startspeed === -1 ? Infinity : a.startspeed;
            const bSpeed = b.startspeed === -1 ? Infinity : b.startspeed;
            return aSpeed - bSpeed;
          }
          case 'date':
            return new Date(a.date).getTime() - new Date(b.date).getTime();
          default:
            return a.rank - b.rank;
        }
      }),
    [allStageRecords, sortField, sortDirection]
  );

  // Search mode: paginate server results (true global ranks).
  // Normal mode: slice loaded records, capped at MAX_STAGE_PAGES.
  const inStageSearchMode = stageSearchQuery.length >= 3;
  const stageSearchApiStart = (stageSearchApiPage - 1) * ITEMS_PER_PAGE;
  const stageStartRow = (stagePage - 1) * ITEMS_PER_PAGE;

  const totalStagePages = inStageSearchMode
    ? Math.ceil(stageSearchApiResults.length / ITEMS_PER_PAGE)
    : Math.min(Math.ceil(totalStageRecords / ITEMS_PER_PAGE), MAX_STAGE_PAGES);

  const paginatedStageRecords = inStageSearchMode
    ? stageSearchApiResults.slice(stageSearchApiStart, stageSearchApiStart + ITEMS_PER_PAGE)
    : sortedStageRecords.slice(stageStartRow, stageStartRow + ITEMS_PER_PAGE);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="px-3 sm:px-6 py-3 border-b border-border bg-surface/50">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          {/* Tab buttons */}
          <div className="flex gap-1">
            <button
              onClick={() => handleTabChange('map')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2 ${
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
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2 ${
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
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2 ${
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
            <RecordSearchInput
              value={searchQuery}
              onChange={handleSearchChange}
              onClear={clearSearch}
              placeholder="Search players..."
            />
          )}

          {/* Search for Bonus tab */}
          {activeTab === 'bonus' && (
            <RecordSearchInput
              value={bonusSearchQuery}
              onChange={handleBonusSearchChange}
              onClear={clearBonusSearch}
              placeholder="Search players..."
            />
          )}

          {/* Search for Stages tab */}
          {activeTab === 'stages' && (
            <RecordSearchInput
              value={stageSearchQuery}
              onChange={handleStageSearchChange}
              onClear={clearStageSearch}
              placeholder="Search players..."
            />
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
          <div className="flex gap-2 mt-4 flex-wrap items-center">
            <span className="text-xs text-text-muted font-medium px-2">
              Top 100 times:
            </span>
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
              <LeaderboardHeaderRow onSort={handleSort} sortField={sortField} sortDirection={sortDirection} />
              <tbody className="bg-surface divide-y divide-border">
                {searchQuery.length > 0 && searchQuery.length < 3 ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
                      Type at least 3 characters to search all players.
                    </td>
                  </tr>
                ) : isSearchingApi ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <LoadingSpinner />
                        <span className="text-text-muted text-sm font-medium">Searching all completions...</span>
                      </div>
                    </td>
                  </tr>
                ) : isLoadingAllLeaderboard ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <LoadingSpinner />
                        <span className="text-text-muted text-sm font-medium">Sorting all completions...</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {paginatedRecords.map((record) => (
                      <RecordRow
                        key={`${record.steamid}-${record.date}`}
                        rank={record.rank}
                        steamid={record.steamid}
                        name={record.name}
                        time={record.runtimepro}
                        wr_time={record.wr_time}
                        startspeed={record.startspeed}
                        date={record.date}
                      />
                    ))}
                    {paginatedRecords.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
                          {inSearchMode ? 'No players found matching your search.' : 'No completions yet.'}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="px-3 sm:px-6 border-t border-border">
              <Pagination
                currentPage={inSearchMode ? searchApiPage : leaderboardPage}
                totalPages={totalPages}
                onPageChange={inSearchMode ? (p) => setSearchApiPage(p) : handlePageChange}
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
              <LeaderboardHeaderRow onSort={handleSort} sortField={sortField} sortDirection={sortDirection} />
              <tbody className="bg-surface divide-y divide-border">
                {bonusSearchQuery.length > 0 && bonusSearchQuery.length < 3 ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
                      Type at least 3 characters to search all players.
                    </td>
                  </tr>
                ) : isBonusSearchingApi ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <LoadingSpinner />
                        <span className="text-text-muted text-sm font-medium">Searching all completions...</span>
                      </div>
                    </td>
                  </tr>
                ) : isLoadingBonuses || isLoadingAllBonus ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <LoadingSpinner />
                        <span className="text-text-muted text-sm font-medium">Loading bonus completions...</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {paginatedBonusRecords.map((record) => (
                      <RecordRow
                        key={`${record.steamid}-${record.zonegroup}`}
                        rank={record.rank}
                        steamid={record.steamid}
                        name={record.name}
                        time={record.runtime}
                        wr_time={record.wr_time}
                        startspeed={record.startspeed}
                        date={record.date}
                      />
                    ))}
                    {paginatedBonusRecords.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
                          {inBonusSearchMode
                            ? 'No players found matching your search.'
                            : `No bonus completions for Bonus ${selectedBonus}.`}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalBonusPages > 1 && (
            <div className="px-3 sm:px-6 border-t border-border">
              <Pagination
                currentPage={inBonusSearchMode ? bonusSearchApiPage : bonusPage}
                totalPages={totalBonusPages}
                onPageChange={inBonusSearchMode ? (p) => setBonusSearchApiPage(p) : handlePageChange}
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
              <LeaderboardHeaderRow onSort={handleStageSort} sortField={sortField} sortDirection={sortDirection} />
              <tbody className="bg-surface divide-y divide-border">
                {stageSearchQuery.length > 0 && stageSearchQuery.length < 3 ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
                      Type at least 3 characters to search all players.
                    </td>
                  </tr>
                ) : isLoadingStages || isStageSearchingApi ? (
                  <tr>
                    <td colSpan={6} className="px-2 sm:px-4 py-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <LoadingSpinner />
                        <span className="text-text-muted text-sm font-medium">
                          {isStageSearchingApi ? 'Searching all completions...' : 'Loading stage completions...'}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {paginatedStageRecords.map((record) => (
                      <RecordRow
                        key={`${record.steamid}-${record.stage}`}
                        rank={record.rank}
                        steamid={record.steamid}
                        name={record.name}
                        time={record.runtime}
                        wr_time={record.wr_time}
                        startspeed={record.startspeed}
                        date={record.date}
                      />
                    ))}
                    {paginatedStageRecords.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-2 sm:px-4 py-8 text-center text-text-muted">
                          {inStageSearchMode ? 'No players found matching your search.' : `No stage completions for Stage ${selectedStage}.`}
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalStagePages > 1 && (
            <div className="px-3 sm:px-6 border-t border-border">
              <Pagination
                currentPage={inStageSearchMode ? stageSearchApiPage : stagePage}
                totalPages={totalStagePages}
                onPageChange={inStageSearchMode ? (p) => setStageSearchApiPage(p) : handlePageChange}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
