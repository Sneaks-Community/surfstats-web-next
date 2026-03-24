'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useState, useTransition, useMemo } from 'react';

interface TierOption {
  tier: number;
  count: number;
}

interface MapFiltersProps {
  tierOptions: TierOption[];
}

// Helper to parse tiers from URL
const parseTiers = (tiersParam: string | null): number[] => {
  if (!tiersParam) return [];
  return tiersParam.split(',').map(t => parseInt(t)).filter(t => !isNaN(t));
};

// Inner component that receives parsed initial values
function MapFiltersForm({
  tierOptions,
  initialQ,
  initialMapper,
  initialType,
  initialBonuses,
  initialTiers
}: MapFiltersProps & {
  initialQ: string;
  initialMapper: string;
  initialType: string;
  initialBonuses: string;
  initialTiers: number[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isExpanded, setIsExpanded] = useState(false);
  
  const [search, setSearch] = useState(initialQ);
  const [mapper, setMapper] = useState(initialMapper);
  const [type, setType] = useState(initialType);
  const [bonuses, setBonuses] = useState(initialBonuses);
  const [selectedTiers, setSelectedTiers] = useState<number[]>(initialTiers);

  const toggleTier = (tier: number) => {
    setSelectedTiers(prev =>
      prev.includes(tier)
        ? prev.filter(t => t !== tier)
        : [...prev, tier]
    );
  };

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (search) params.set('q', search);
    if (mapper) params.set('mapper', mapper);
    if (type !== 'all') params.set('type', type);
    if (bonuses !== 'all') params.set('bonuses', bonuses);
    if (selectedTiers.length > 0) params.set('tiers', selectedTiers.join(','));
    
    const queryString = params.toString();
    startTransition(() => {
      router.push(queryString ? `/maps?${queryString}` : '/maps');
    });
  };

  const clearFilters = () => {
    setSearch('');
    setMapper('');
    setType('all');
    setBonuses('all');
    setSelectedTiers([]);
    startTransition(() => {
      router.push('/maps');
    });
  };

  // Count filters that are in the collapsible section (not default values)
  const advancedFiltersCount = useMemo(
    () => {
      let count = 0;
      if (mapper) count++;
      if (type !== 'all') count++;
      if (bonuses !== 'all') count++;
      if (selectedTiers.length > 0) count++;
      return count;
    },
    [mapper, type, bonuses, selectedTiers]
  );

  // Check if any filters are active (for showing clear button)
  const hasFilters = useMemo(
    () => search || mapper || type !== 'all' || bonuses !== 'all' || selectedTiers.length > 0,
    [search, mapper, type, bonuses, selectedTiers]
  );

  return (
    <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
      {/* Always Visible Row: Search + More Filters Toggle + Apply Button */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-text-placeholder" />
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface-hover focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
            placeholder="Search maps..."
          />
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-4 py-2 bg-surface-hover hover:bg-surface-active text-text-muted text-sm font-medium rounded-md transition-colors inline-flex items-center gap-2 whitespace-nowrap"
          aria-expanded={isExpanded}
          aria-controls="advanced-filters"
        >
          <span>More Filters</span>
          {advancedFiltersCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-semibold rounded-full bg-primary/20 text-primary">
              {advancedFiltersCount}
            </span>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          onClick={applyFilters}
          disabled={isPending}
          className="px-4 py-2 bg-primary-600 hover:bg-primary-500 disabled:bg-primary-600/50 text-white text-sm font-medium rounded-md transition-colors whitespace-nowrap"
        >
          {isPending ? 'Applying...' : 'Apply Filters'}
        </button>
      </div>

      {/* Collapsible Advanced Filters */}
      <div
        id="advanced-filters"
        className={`space-y-4 overflow-hidden transition-all duration-200 ${isExpanded ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
      >
        {/* Row: Mapper + Type + Bonuses */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-text-placeholder" />
            </div>
            <input
              type="text"
              value={mapper}
              onChange={(e) => setMapper(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="block w-full pl-10 pr-3 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text placeholder-text-placeholder focus:outline-none focus:bg-surface-hover focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
              placeholder="Search by mapper..."
            />
          </div>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="block w-full sm:w-32 pl-3 pr-10 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
          >
            <option value="all">All Types</option>
            <option value="linear">Linear</option>
            <option value="staged">Staged</option>
          </select>
          <select
            value={bonuses}
            onChange={(e) => setBonuses(e.target.value)}
            className="block w-full sm:w-38 pl-3 pr-10 py-2 border border-border rounded-md leading-5 bg-background-secondary text-text focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-border-focus sm:text-sm transition-colors"
          >
            <option value="all">All Bonuses</option>
            <option value="0">0 Bonuses</option>
            <option value="1">1 Bonus</option>
            <option value="2">2 Bonuses</option>
            <option value="3">3 Bonuses</option>
            <option value="4+">4+ Bonuses</option>
          </select>
        </div>
        
        {/* Tier Checkboxes */}
        <div className="flex flex-wrap items-center gap-2">
          {tierOptions.filter(tier => tier.tier >= 1 && tier.tier <= 10).map((tier) => (
            <button
              key={tier.tier}
              type="button"
              onClick={() => toggleTier(tier.tier)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleTier(tier.tier)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] min-w-[44px] rounded-md text-sm font-medium cursor-pointer transition-colors ${
                selectedTiers.includes(tier.tier)
                  ? 'bg-primary/20 text-primary border border-primary/50'
                  : 'bg-surface-hover text-text-muted border border-border hover:border-border-hover'
              }`}
            >
              <span>T{tier.tier}</span>
              <span className="text-xs text-text-placeholder">({tier.count})</span>
            </button>
          ))}
        </div>
        
        {/* Clear Filters Button */}
        {hasFilters && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={clearFilters}
              disabled={isPending}
              className="px-4 py-2 bg-surface-hover hover:bg-surface-active disabled:bg-surface-hover/50 text-text-muted text-sm font-medium rounded-md transition-colors inline-flex items-center gap-2"
            >
              <X className="h-4 w-4" />
              Clear Filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Wrapper component that reads URL params and creates a key for re-initialization
export default function MapFilters({ tierOptions }: MapFiltersProps) {
  const searchParams = useSearchParams();
  
  // Parse URL params once per render to create the key
  const urlParams = useMemo(() => ({
    q: searchParams.get('q') || '',
    mapper: searchParams.get('mapper') || '',
    type: searchParams.get('type') || 'all',
    bonuses: searchParams.get('bonuses') || 'all',
    tiers: parseTiers(searchParams.get('tiers')),
  }), [searchParams]);
  
  // Create a stable key based on URL params - this forces re-mount when URL changes
  const formKey = useMemo(() => 
    JSON.stringify(urlParams),
    [urlParams]
  );
  
  return (
    <MapFiltersForm
      key={formKey}
      tierOptions={tierOptions}
      initialQ={urlParams.q}
      initialMapper={urlParams.mapper}
      initialType={urlParams.type}
      initialBonuses={urlParams.bonuses}
      initialTiers={urlParams.tiers}
    />
  );
}