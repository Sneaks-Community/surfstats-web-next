'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { Trophy, Target, Layers } from 'lucide-react';
import RecordSearchInput from '@/components/RecordSearchInput';
import {
  sortRecords,
  matchesQuery,
  parseIntParam,
  wrDiff,
  ITEMS_PER_PAGE,
  RECORDS_PAGE_SIZE,
  isStagedMap,
  type SortDirection,
} from '@/lib/utils';
import { useRecordSearch, type LoadError } from '@/hooks/useRecordSearch';
import { useTabs } from '@/hooks/useTabs';
import { clientError } from '@/lib/client-logger';
import { getErrorMessage, isAbortError } from '@/lib/errors';
import { fetchJson } from '@/lib/fetch-json';
import type { BonusRecord, MapRecord, StageRecord } from '@/lib/map-records-cache';
import LeaderboardTable, { type LeaderboardRow, type SortField } from './LeaderboardTable';

interface MapRecordsTabsProps {
  totalRecords: number;
  mapname: string;
  numBonuses: number;
  numStages: number;
}

// Paginated (non-search) shapes; bonus search returns `records` instead of `bonuses`.
interface RecordsResponse {
  records?: MapRecord[];
  pagination?: { total: number };
}
interface BonusesResponse {
  bonuses?: BonusRecord[];
  pagination?: { total: number };
}
interface StagesResponse {
  stages?: StageRecord[];
  pagination?: { total: number };
}

type TabType = 'map' | 'bonus' | 'stages';

const TABS: readonly TabType[] = ['map', 'bonus', 'stages'];
const SORT_FIELDS: readonly SortField[] = ['rank', 'player', 'time', 'speed', 'wrDiff', 'date'];
const SORT_DIRS: readonly SortDirection[] = ['asc', 'desc'];

// Allowlist, so a crafted `?sort=` can't read as "not rank" and arm the load-all fan-out.
function oneOf<T extends string>(allowed: readonly T[], raw: string | null, fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

const MAX_STAGE_RECORDS = 100;
// The stages API returns all 100 records at once, paginated client-side.
const MAX_STAGE_PAGES = Math.ceil(MAX_STAGE_RECORDS / ITEMS_PER_PAGE);

interface SortableRecord {
  name: string;
  rank: number;
  date: string;
  startspeed: number;
  wr_time: number | null;
}

/** Shared by all three tabs (only the time field differs), so date sorts newest-first on each. */
function compareRecords<T extends SortableRecord>(
  field: SortField,
  time: (record: T) => number
) {
  return (a: T, b: T): number => {
    switch (field) {
      case 'player':
        return a.name.localeCompare(b.name);
      case 'time':
        return time(a) - time(b);
      case 'speed': {
        // -1 = no speed data; push to the end like the wrDiff sentinel.
        const aSpeed = a.startspeed === -1 ? Infinity : a.startspeed;
        const bSpeed = b.startspeed === -1 ? Infinity : b.startspeed;
        return aSpeed - bSpeed;
      }
      case 'wrDiff':
        return wrDiff(time(a), a.wr_time) - wrDiff(time(b), b.wr_time);
      case 'date':
        // Newest first: ascending is reverse-chronological.
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      default:
        return a.rank - b.rank;
    }
  };
}

const toMapRow = (r: MapRecord): LeaderboardRow => ({
  key: `${r.steamid}-${r.date}`,
  rank: r.rank,
  steamid: r.steamid,
  name: r.name,
  time: r.runtimepro,
  wr_time: r.wr_time,
  startspeed: r.startspeed,
  date: r.date,
});

const toBonusRow = (r: BonusRecord): LeaderboardRow => ({
  key: `${r.steamid}-${r.zonegroup}`,
  rank: r.rank,
  steamid: r.steamid,
  name: r.name,
  time: r.runtime,
  wr_time: r.wr_time,
  startspeed: r.startspeed,
  date: r.date,
});

const toStageRow = (r: StageRecord): LeaderboardRow => ({
  key: `${r.steamid}-${r.stage}`,
  rank: r.rank,
  steamid: r.steamid,
  name: r.name,
  time: r.runtime,
  wr_time: r.wr_time,
  startspeed: r.startspeed,
  date: r.date,
});

export default function MapRecordsTabs({
  totalRecords,
  mapname,
  numBonuses,
  numStages,
}: MapRecordsTabsProps) {
  const searchParams = useSearchParams();
  const staged = isStagedMap({ stages: numStages });

  const initialTab = oneOf(TABS, searchParams.get('tab'), 'map');
  const initialPage = parseIntParam(searchParams.get('page'));
  const initialBonus = parseIntParam(searchParams.get('bonus'));
  const initialBonusPage = parseIntParam(searchParams.get('bonusPage'));
  const initialStage = parseIntParam(searchParams.get('stage'));
  const initialStagePage = parseIntParam(searchParams.get('stagePage'));
  const initialSortField = oneOf(SORT_FIELDS, searchParams.get('sort'), 'rank');
  const initialSortDir = oneOf(SORT_DIRS, searchParams.get('dir'), 'asc');

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [leaderboardPage, setLeaderboardPage] = useState(initialPage);
  const [selectedBonus, setSelectedBonus] = useState(initialBonus);
  const [bonusPage, setBonusPage] = useState(initialBonusPage);
  const [selectedStage, setSelectedStage] = useState(initialStage);
  const [stagePage, setStagePage] = useState(initialStagePage);
  const [sortField, setSortField] = useState<SortField>(initialSortField);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDir);
  const { tablistProps, tabProps, panelProps } = useTabs(activeTab);

  // Starts empty; page 1 is fetched on mount (Times activation), not server-rendered.
  const [allLeaderboardRecords, setAllLeaderboardRecords] = useState<MapRecord[]>([]);
  // Pages already merged above, so non-sequential navigation skips refetching them.
  const loadedPagesRef = useRef<Set<number>>(new Set());
  // Fetched bonus pages, keyed "${bonus}-${page}".
  const bonusCacheRef = useRef<Map<string, BonusRecord[]>>(new Map());

  const [allStageRecords, setAllStageRecords] = useState<StageRecord[]>([]);
  const [totalStageRecords, setTotalStageRecords] = useState(0);
  const [isLoadingStages, setIsLoadingStages] = useState(false);

  const [allBonusRecords, setAllBonusRecords] = useState<BonusRecord[]>([]);
  const [totalBonusRecords, setTotalBonusRecords] = useState(0);
  const [isLoadingBonuses, setIsLoadingBonuses] = useState(false);

  const allLeaderboardLoadedRef = useRef<boolean>(totalRecords <= 0);
  const [isLoadingAllLeaderboard, setIsLoadingAllLeaderboard] = useState(false);
  const allBonusLoadedRef = useRef<Set<number>>(new Set());
  const [isLoadingAllBonus, setIsLoadingAllBonus] = useState(false);

  // One tab renders at a time, so one slot covers all three tabs' paginated loads.
  // Each search owns its own error (see `useRecordSearch`).
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  // One server-side search per tab; the URL closes over the map and selected bonus/stage,
  // so changing either re-runs that tab's search.
  const mapSearch = useRecordSearch<MapRecord>({
    initialQuery: searchParams.get('q') ?? '',
    url: (q) => `/api/maps/${mapname}/records?q=${encodeURIComponent(q)}`,
    rowsKey: 'records',
    label: 'MapRecordsTabs',
  });
  const bonusSearch = useRecordSearch<BonusRecord>({
    initialQuery: searchParams.get('bq') ?? '',
    url: (q) => `/api/maps/${mapname}/bonuses?bonus=${selectedBonus}&q=${encodeURIComponent(q)}`,
    rowsKey: 'records',
    label: 'MapRecordsTabs bonus',
  });
  const stageSearch = useRecordSearch<StageRecord>({
    initialQuery: searchParams.get('sq') ?? '',
    url: (q) => `/api/maps/${mapname}/stages?stage=${selectedStage}&q=${encodeURIComponent(q)}`,
    rowsKey: 'stages',
    label: 'MapRecordsTabs stage',
  });

  // Reset on map change; mapname is the only dep, to avoid pagination issues.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset on map change; the load effect refetches page 1
    setAllLeaderboardRecords([]);
    loadedPagesRef.current = new Set();
    allLeaderboardLoadedRef.current = totalRecords <= 0;
    allBonusLoadedRef.current = new Set();
    setLeaderboardPage(1);
    bonusCacheRef.current = new Map();
    setAllStageRecords([]);
    setAllBonusRecords([]);
    setTotalStageRecords(0);
    setTotalBonusRecords(0);
    setLoadError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapname]);

  // Map tab, rank sort: fetch the current page if not loaded (on mount, the deferred page 1).
  // Non-rank sorts and search use their own paths.
  useEffect(() => {
    if (activeTab !== 'map' || sortField !== 'rank' || mapSearch.active) return;
    if (loadedPagesRef.current.has(leaderboardPage)) return;

    const controller = new AbortController();
    void (async () => {
      setIsLoadingAllLeaderboard(true);
      setLoadError(null);
      try {
        const data = await fetchJson<RecordsResponse>(
          `/api/maps/${mapname}/records?page=${leaderboardPage}&pageSize=${ITEMS_PER_PAGE}`,
          { signal: controller.signal }
        );
        const loaded = data.records ?? [];
        if (loaded.length > 0) {
          setAllLeaderboardRecords((prev) => {
            const existingIds = new Set(prev.map((r) => r.steamid + r.date));
            return [...prev, ...loaded.filter((r) => !existingIds.has(r.steamid + r.date))];
          });
        }
        loadedPagesRef.current.add(leaderboardPage);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        clientError(`Failed to load records: ${getErrorMessage(err)}`);
        setLoadError({ message: getErrorMessage(err), retry: () => setRetryToken((t) => t + 1) });
      } finally {
        if (!controller.signal.aborted) setIsLoadingAllLeaderboard(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, sortField, mapSearch.active, leaderboardPage, mapname, retryToken]);

  // Loads the stage's top 100 in rank order (sorting is client-side). Aborts rather than
  // guarding in-flight, so a stale response from rapid stage switching never wins.
  useEffect(() => {
    if (activeTab !== 'stages' || !staged) return;

    const controller = new AbortController();
    void (async () => {
      setIsLoadingStages(true);
      setLoadError(null);
      try {
        const data = await fetchJson<StagesResponse>(
          `/api/maps/${mapname}/stages?stage=${selectedStage}`,
          { signal: controller.signal }
        );
        setAllStageRecords(data.stages ?? []);
        setTotalStageRecords(data.pagination?.total ?? 0);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        clientError(`Failed to load stage records: ${getErrorMessage(err)}`);
        setAllStageRecords([]);
        setTotalStageRecords(0);
        setLoadError({ message: getErrorMessage(err), retry: () => setRetryToken((t) => t + 1) });
      } finally {
        if (!controller.signal.aborted) setIsLoadingStages(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, selectedStage, staged, mapname, retryToken]);

  // One bonus page, cached per bonus/page. Skipped under a non-rank sort, which needs the full
  // set (load-all path below). Failures are never cached, so a retry re-fetches.
  useEffect(() => {
    if (activeTab !== 'bonus' || numBonuses === 0 || sortField !== 'rank') return;

    const cacheKey = `${selectedBonus}-${bonusPage}`;
    const cachedData = bonusCacheRef.current.get(cacheKey);
    if (cachedData) {
      setAllBonusRecords(cachedData);
      setIsLoadingBonuses(false);
      setLoadError(null);
      return;
    }

    const controller = new AbortController();
    void (async () => {
      setIsLoadingBonuses(true);
      setLoadError(null);
      try {
        const data = await fetchJson<BonusesResponse>(
          `/api/maps/${mapname}/bonuses?bonus=${selectedBonus}&page=${bonusPage}&pageSize=${ITEMS_PER_PAGE}`,
          { signal: controller.signal }
        );
        const rows = data.bonuses ?? [];
        bonusCacheRef.current.set(cacheKey, rows);
        // A single rank-window page, so the full set is no longer loaded.
        allBonusLoadedRef.current.delete(selectedBonus);
        setAllBonusRecords(rows);
        setTotalBonusRecords(data.pagination?.total ?? 0);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        clientError(`Failed to load bonus records: ${getErrorMessage(err)}`);
        setAllBonusRecords([]);
        setTotalBonusRecords(0);
        setLoadError({ message: getErrorMessage(err), retry: () => setRetryToken((t) => t + 1) });
      } finally {
        if (!controller.signal.aborted) setIsLoadingBonuses(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, selectedBonus, bonusPage, numBonuses, sortField, mapname, retryToken]);

  // Non-rank sort on the map tab: load the full leaderboard once so pages follow the global sort.
  useEffect(() => {
    if (activeTab !== 'map') return;
    if (sortField === 'rank') return;
    if (mapSearch.active) return;
    if (allLeaderboardLoadedRef.current) return;

    const controller = new AbortController();
    void (async () => {
      setIsLoadingAllLeaderboard(true);
      setLoadError(null);
      try {
        const apiPages = Math.max(1, Math.ceil(totalRecords / RECORDS_PAGE_SIZE));
        const merged = new Map<string, MapRecord>();
        for (let p = 1; p <= apiPages; p++) {
          const data = await fetchJson<RecordsResponse>(
            `/api/maps/${mapname}/records?page=${p}&pageSize=${RECORDS_PAGE_SIZE}`,
            { signal: controller.signal }
          );
          if (Array.isArray(data.records)) {
            for (const r of data.records) merged.set(r.steamid + r.date, r);
          }
        }
        setAllLeaderboardRecords(Array.from(merged.values()));
        allLeaderboardLoadedRef.current = true;
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        clientError(`Failed to load all records for sorting: ${getErrorMessage(err)}`);
        setLoadError({ message: getErrorMessage(err), retry: () => setRetryToken((t) => t + 1) });
      } finally {
        if (!controller.signal.aborted) setIsLoadingAllLeaderboard(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, sortField, mapSearch.active, mapname, totalRecords, retryToken]);

  // Same load-all path for the bonus tab, per bonus.
  useEffect(() => {
    if (activeTab !== 'bonus') return;
    if (sortField === 'rank') return;
    if (bonusSearch.active) return;
    if (allBonusLoadedRef.current.has(selectedBonus)) return;

    const controller = new AbortController();
    void (async () => {
      setIsLoadingAllBonus(true);
      setLoadError(null);
      try {
        const merged = new Map<string, BonusRecord>();
        let total = Infinity;
        for (let p = 1; (p - 1) * RECORDS_PAGE_SIZE < total; p++) {
          const data = await fetchJson<BonusesResponse>(
            `/api/maps/${mapname}/bonuses?bonus=${selectedBonus}&page=${p}&pageSize=${RECORDS_PAGE_SIZE}`,
            { signal: controller.signal }
          );
          total = data.pagination?.total ?? 0;
          if (Array.isArray(data.bonuses) && data.bonuses.length > 0) {
            for (const r of data.bonuses) merged.set(`${r.steamid}-${r.zonegroup}`, r);
          } else {
            break;
          }
        }
        setAllBonusRecords(Array.from(merged.values()));
        setTotalBonusRecords(merged.size);
        allBonusLoadedRef.current.add(selectedBonus);
      } catch (err: unknown) {
        if (isAbortError(err)) return;
        clientError(`Failed to load all bonus records for sorting: ${getErrorMessage(err)}`);
        setLoadError({ message: getErrorMessage(err), retry: () => setRetryToken((t) => t + 1) });
      } finally {
        if (!controller.signal.aborted) setIsLoadingAllBonus(false);
      }
    })();
    return () => controller.abort();
  }, [activeTab, sortField, bonusSearch.active, selectedBonus, mapname, retryToken]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tab', activeTab);
    params.set('page', leaderboardPage.toString());
    params.set('bonus', selectedBonus.toString());
    params.set('bonusPage', bonusPage.toString());
    params.set('stage', selectedStage.toString());
    params.set('stagePage', stagePage.toString());
    if (mapSearch.query) params.set('q', mapSearch.query);
    if (bonusSearch.query) params.set('bq', bonusSearch.query);
    if (stageSearch.query) params.set('sq', stageSearch.query);
    // Sort is shared across tabs and written as sort/dir, the names the initializer above reads.
    if (sortField !== 'rank') params.set('sort', sortField);
    if (sortDirection !== 'asc') params.set('dir', sortDirection);

    const query = params.toString();
    if (query !== window.location.search.slice(1)) {
      window.history.replaceState(null, '', `?${query}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, leaderboardPage, selectedBonus, bonusPage, selectedStage, stagePage, mapSearch.debouncedQuery, bonusSearch.debouncedQuery, stageSearch.debouncedQuery, sortField, sortDirection]);

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    setSortField('rank');
    setSortDirection('asc');
    // The error slot is shared across tabs; don't carry one tab's failure over.
    setLoadError(null);
  };

  // Map tab fetches unloaded pages first. Explicit return type: the retry closure recurses.
  const handlePageChange = async (page: number): Promise<void> => {
    if (activeTab === 'map') {
      // Full set already loaded (non-rank sort path).
      if (allLeaderboardLoadedRef.current) {
        setLeaderboardPage(page);
        return;
      }
      if (!loadedPagesRef.current.has(page)) {
        try {
          const data = await fetchJson<RecordsResponse>(
            `/api/maps/${mapname}/records?page=${page}&pageSize=${ITEMS_PER_PAGE}`
          );
          const loaded = data.records ?? [];
          if (loaded.length > 0) {
            setAllLeaderboardRecords((prev) => {
              const existingIds = new Set(prev.map((r) => r.steamid + r.date));
              return [...prev, ...loaded.filter((r) => !existingIds.has(r.steamid + r.date))];
            });
            loadedPagesRef.current.add(page);
          }
        } catch (err: unknown) {
          // Stay on the current page: advancing would render an empty table.
          clientError(`Failed to load records: ${getErrorMessage(err)}`);
          setLoadError({ message: getErrorMessage(err), retry: () => void handlePageChange(page) });
          return;
        }
      }
      setLoadError(null);
      setLeaderboardPage(page);
    } else if (activeTab === 'bonus') {
      setBonusPage(page);
    } else {
      setStagePage(page);
    }
  };

  // Searching resets that tab's own pagination as well as the search results'.
  const handleSearchChange = (value: string) => {
    mapSearch.onChange(value);
    setLeaderboardPage(1);
  };
  const handleBonusSearchChange = (value: string) => {
    bonusSearch.onChange(value);
    setBonusPage(1);
  };
  const handleStageSearchChange = (value: string) => {
    stageSearch.onChange(value);
    setStagePage(1);
  };

  const clearSearch = () => {
    mapSearch.clear();
    setLeaderboardPage(1);
  };
  const clearBonusSearch = () => {
    bonusSearch.clear();
    setBonusPage(1);
  };
  const clearStageSearch = () => {
    stageSearch.clear();
    setStagePage(1);
  };

  // Map and bonus tabs (client-side sort).
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    // Pages follow the sorted order under a non-rank sort; a stale high page could be out of range.
    setLeaderboardPage(1);
    setBonusPage(1);
  };

  const handleStageSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setStagePage(1);
  };

  const sortedRecords = useMemo(() => {
    const query = mapSearch.debouncedQuery;
    const filtered = query
      ? allLeaderboardRecords.filter((r) => matchesQuery(query, r.name, r.steamid))
      : allLeaderboardRecords;
    return sortRecords(filtered, sortDirection, compareRecords(sortField, (r) => r.runtimepro));
  }, [allLeaderboardRecords, mapSearch.debouncedQuery, sortField, sortDirection]);

  const sortedBonusRecords = useMemo(() => {
    const query = bonusSearch.debouncedQuery;
    const filtered = query
      ? allBonusRecords.filter((r) => matchesQuery(query, r.name, r.steamid))
      : allBonusRecords;
    return sortRecords(filtered, sortDirection, compareRecords(sortField, (r) => r.runtime));
  }, [allBonusRecords, bonusSearch.debouncedQuery, sortField, sortDirection]);

  // Arrives in rank order; `rank` sorts by runtime instead, since tied stage times share a rank.
  const sortedStageRecords = useMemo(
    () =>
      sortRecords(
        allStageRecords,
        sortDirection,
        compareRecords(sortField === 'rank' ? 'time' : sortField, (r) => r.runtime)
      ),
    [allStageRecords, sortField, sortDirection]
  );

  // Search (≥3 chars) pages the server results; rank sort filters by rank window (pages load
  // lazily, out of order); non-rank sort slices the fully loaded set (load-all effects).
  const rankWindow = <T extends { rank: number }>(rows: T[], page: number): T[] =>
    rows.filter((r) => r.rank >= (page - 1) * ITEMS_PER_PAGE + 1 && r.rank <= page * ITEMS_PER_PAGE);
  const pageSlice = <T,>(rows: T[], page: number): T[] =>
    rows.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const mapRows = mapSearch.active
    ? mapSearch.pageRows
    : sortField === 'rank'
      ? rankWindow(sortedRecords, leaderboardPage)
      : pageSlice(sortedRecords, leaderboardPage);

  const bonusRows = bonusSearch.active
    ? bonusSearch.pageRows
    : sortField === 'rank'
      ? rankWindow(sortedBonusRecords, bonusPage)
      : pageSlice(sortedBonusRecords, bonusPage);

  const stageRows = stageSearch.active
    ? stageSearch.pageRows
    : pageSlice(sortedStageRecords, stagePage);

  const tabButtonClass = (isActive: boolean) =>
    `px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-2 ${
      isActive
        ? 'bg-primary-600 text-white'
        : 'bg-surface-hover text-text-muted hover:bg-surface-hover/70 hover:text-text'
    }`;

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="px-3 sm:px-6 py-3 border-b border-border bg-surface/50">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex gap-1" {...tablistProps}>
            <button {...tabProps('map')} onClick={() => handleTabChange('map')} className={tabButtonClass(activeTab === 'map')}>
              <Trophy className="h-4 w-4" />
              Map
            </button>
            {numBonuses > 0 && (
              <button {...tabProps('bonus')} onClick={() => handleTabChange('bonus')} className={tabButtonClass(activeTab === 'bonus')}>
                <Target className="h-4 w-4" />
                Bonus
              </button>
            )}
            {staged && (
              <button {...tabProps('stages')} onClick={() => handleTabChange('stages')} className={tabButtonClass(activeTab === 'stages')}>
                <Layers className="h-4 w-4" />
                Stages
              </button>
            )}
          </div>

          {activeTab === 'map' && (
            <RecordSearchInput
              value={mapSearch.query}
              onChange={handleSearchChange}
              onClear={clearSearch}
              placeholder="Search players..."
            />
          )}
          {activeTab === 'bonus' && (
            <RecordSearchInput
              value={bonusSearch.query}
              onChange={handleBonusSearchChange}
              onClear={clearBonusSearch}
              placeholder="Search players..."
            />
          )}
          {activeTab === 'stages' && (
            <RecordSearchInput
              value={stageSearch.query}
              onChange={handleStageSearchChange}
              onClear={clearStageSearch}
              placeholder="Search players..."
            />
          )}
        </div>

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

        {activeTab === 'stages' && staged && (
          <div className="flex gap-2 mt-4 flex-wrap items-center">
            <span className="text-xs text-text-muted font-medium px-2">Top 100 times:</span>
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

      <div {...panelProps(activeTab)}>
        {activeTab === 'map' && (
          <LeaderboardTable
            rows={mapRows.map(toMapRow)}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            query={mapSearch.query}
            error={mapSearch.error ?? loadError}
            loading={mapSearch.isSearching || isLoadingAllLeaderboard}
            loadingLabel={mapSearch.isSearching ? 'Searching all completions...' : 'Sorting all completions...'}
            emptyMessage={mapSearch.active ? 'No players found matching your search.' : 'No completions yet.'}
            page={mapSearch.active ? mapSearch.page : leaderboardPage}
            totalPages={mapSearch.active ? mapSearch.totalPages : Math.ceil(totalRecords / ITEMS_PER_PAGE)}
            onPageChange={mapSearch.active ? mapSearch.setPage : handlePageChange}
          />
        )}

        {activeTab === 'bonus' && numBonuses > 0 && (
          <LeaderboardTable
            rows={bonusRows.map(toBonusRow)}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            query={bonusSearch.query}
            error={bonusSearch.error ?? loadError}
            loading={bonusSearch.isSearching || isLoadingBonuses || isLoadingAllBonus}
            loadingLabel={bonusSearch.isSearching ? 'Searching all completions...' : 'Loading bonus completions...'}
            emptyMessage={
              bonusSearch.active
                ? 'No players found matching your search.'
                : `No bonus completions for Bonus ${selectedBonus}.`
            }
            page={bonusSearch.active ? bonusSearch.page : bonusPage}
            totalPages={bonusSearch.active ? bonusSearch.totalPages : Math.ceil(totalBonusRecords / ITEMS_PER_PAGE)}
            onPageChange={bonusSearch.active ? bonusSearch.setPage : handlePageChange}
          />
        )}

        {activeTab === 'stages' && staged && (
          <LeaderboardTable
            rows={stageRows.map(toStageRow)}
            sortField={sortField}
            sortDirection={sortDirection}
            onSort={handleStageSort}
            query={stageSearch.query}
            error={stageSearch.error ?? loadError}
            loading={stageSearch.isSearching || isLoadingStages}
            loadingLabel={stageSearch.isSearching ? 'Searching all completions...' : 'Loading stage completions...'}
            emptyMessage={
              stageSearch.active
                ? 'No players found matching your search.'
                : `No stage completions for Stage ${selectedStage}.`
            }
            page={stageSearch.active ? stageSearch.page : stagePage}
            totalPages={
              stageSearch.active
                ? stageSearch.totalPages
                : Math.min(Math.ceil(totalStageRecords / ITEMS_PER_PAGE), MAX_STAGE_PAGES)
            }
            onPageChange={stageSearch.active ? stageSearch.setPage : handlePageChange}
          />
        )}
      </div>
    </div>
  );
}
