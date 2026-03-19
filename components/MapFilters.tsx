'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
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

  // Memoize hasFilters to prevent unnecessary re-renders
  const hasFilters = useMemo(
    () => search || mapper || type !== 'all' || bonuses !== 'all' || selectedTiers.length > 0,
    [search, mapper, type, bonuses, selectedTiers]
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
      <div className="space-y-4">
        {/* Row 1: Search and Type */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-zinc-400" />
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="block w-full pl-10 pr-3 py-2 border border-zinc-700 rounded-md leading-5 bg-zinc-800 text-zinc-300 placeholder-zinc-400 focus:outline-none focus:bg-zinc-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm transition-colors"
              placeholder="Search maps..."
            />
          </div>
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-4 w-4 text-zinc-400" />
            </div>
            <input
              type="text"
              value={mapper}
              onChange={(e) => setMapper(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="block w-full pl-10 pr-3 py-2 border border-zinc-700 rounded-md leading-5 bg-zinc-800 text-zinc-300 placeholder-zinc-400 focus:outline-none focus:bg-zinc-700 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm transition-colors"
              placeholder="Search by mapper..."
            />
          </div>
          <select 
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="block w-full sm:w-32 pl-3 pr-10 py-2 border border-zinc-700 rounded-md leading-5 bg-zinc-800 text-zinc-300 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm transition-colors"
          >
            <option value="all">All Types</option>
            <option value="linear">Linear</option>
            <option value="staged">Staged</option>
          </select>
          <select 
            value={bonuses}
            onChange={(e) => setBonuses(e.target.value)}
            className="block w-full sm:w-32 pl-3 pr-10 py-2 border border-zinc-700 rounded-md leading-5 bg-zinc-800 text-zinc-300 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm transition-colors"
          >
            <option value="all">All Bonuses</option>
            <option value="0">0 Bonuses</option>
            <option value="1">1 Bonus</option>
            <option value="2">2 Bonuses</option>
            <option value="3">3 Bonuses</option>
            <option value="4+">4+ Bonuses</option>
          </select>
        </div>
        
        {/* Row 2: Tier Checkboxes */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-400 mr-2">Tiers:</span>
          {tierOptions.map((tier) => (
            <button
              key={tier.tier}
              type="button"
              onClick={() => toggleTier(tier.tier)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggleTier(tier.tier)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] min-w-[44px] rounded-md text-sm font-medium cursor-pointer transition-colors ${
                selectedTiers.includes(tier.tier)
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-600'
              }`}
            >
              <span>T{tier.tier}</span>
              <span className="text-xs text-zinc-500">({tier.count})</span>
            </button>
          ))}
        </div>
        
        {/* Row 3: Submit Button */}
        <div className="flex gap-3">
          <button 
            type="button"
            onClick={applyFilters}
            disabled={isPending}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white text-sm font-medium rounded-md transition-colors"
          >
            {isPending ? 'Applying...' : 'Apply Filters'}
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              disabled={isPending}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-700/50 text-zinc-300 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-2"
            >
              <X className="h-4 w-4" />
              Clear Filters
            </button>
          )}
        </div>
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
  const key = `${urlParams.q}|${urlParams.mapper}|${urlParams.type}|${urlParams.bonuses}|${urlParams.tiers.join(',')}`;
  
  return (
    <MapFiltersForm
      key={key}
      tierOptions={tierOptions}
      initialQ={urlParams.q}
      initialMapper={urlParams.mapper}
      initialType={urlParams.type}
      initialBonuses={urlParams.bonuses}
      initialTiers={urlParams.tiers}
    />
  );
}
