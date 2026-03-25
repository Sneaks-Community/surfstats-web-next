-- Performance indexes for query optimization
-- These indexes reduce rows examined and enable covering index scans

-- ============================================================
-- PLAYER TIMES TABLE (ck_playertimes)
-- ============================================================

-- Covering index for player records lookup (most common query pattern)
-- Used when fetching all records for a specific player
-- Includes all columns needed for the player records page
CREATE INDEX idx_playertimes_player_records ON ck_playertimes(steamid, mapname, runtimepro, date, name);

-- Covering index for map leaderboard queries
-- Used when fetching top times for a specific map
-- Includes columns needed for leaderboard display
CREATE INDEX idx_playertimes_map_leaderboard ON ck_playertimes(mapname, runtimepro, steamid, name, date);

-- Index for world record queries (MIN runtime per map)
-- Used to find the best time for each map
CREATE INDEX idx_playertimes_wr_lookup ON ck_playertimes(mapname, runtimepro);

-- ============================================================
-- BONUS TABLE (ck_bonus)
-- ============================================================

-- Covering index for player bonus records
-- Used when fetching all bonus records for a specific player
CREATE INDEX idx_bonus_player_records ON ck_bonus(steamid, mapname, zonegroup, runtime, date);

-- Covering index for bonus leaderboard queries
-- Used when fetching top times for a specific bonus
CREATE INDEX idx_bonus_leaderboard ON ck_bonus(mapname, zonegroup, runtime, steamid, name, date);

-- ============================================================
-- STAGES TABLE (ck_stages)
-- ============================================================

-- Covering index for player stage records
-- Used when fetching all stage records for a specific player
CREATE INDEX idx_stages_player_records ON ck_stages(steamid, map, stage, runtime, date);

-- Covering index for stage leaderboard queries
-- Used when fetching top times for a specific stage
CREATE INDEX idx_stages_leaderboard ON ck_stages(map, stage, runtime, steamid, name, date);

-- ============================================================
-- PLAYER RANK TABLE (ck_playerrank)
-- ============================================================

-- Index for player search by name (prefix index for LIKE queries)
-- Used in player search functionality
CREATE INDEX idx_playerrank_name_search ON ck_playerrank(name(50));

-- Index for leaderboard ordering by points
-- Used when displaying player rankings
CREATE INDEX idx_playerrank_points_rank ON ck_playerrank(points DESC);

-- ============================================================
-- MAP TIER TABLE (ck_maptier)
-- ============================================================

-- Index for tier filtering in map listing
-- Used when filtering maps by tier
CREATE INDEX idx_maptier_tier_filter ON ck_maptier(tier, mapname);

-- ============================================================
-- ZONES TABLE (ck_zones)
-- ============================================================

-- Index for bonus/stage count queries
-- Used when counting bonuses and stages per map
CREATE INDEX idx_zones_map_counts ON ck_zones(mapname, zonegroup, zonetype);

-- ============================================================
-- LATEST RECORDS TABLE (ck_latestrecords)
-- ============================================================

-- Index for recent records query (already has ORDER BY date DESC)
-- Used on homepage for recent records display
CREATE INDEX idx_latestrecords_date ON ck_latestrecords(date DESC);

-- ============================================================
-- NOTES ON INDEX USAGE
-- ============================================================
-- 
-- 1. Covering indexes include all columns needed by a query
--    This allows MySQL to satisfy the query from the index alone
--    without looking up the data rows (Extra: Using index in EXPLAIN)
--
-- 2. Composite index column order follows leftmost prefix rule:
--    - Equality conditions first (WHERE col = value)
--    - Range/sort conditions after (WHERE col > value, ORDER BY)
--
-- 3. Prefix indexes on TEXT/VARCHAR columns (name(50))
--    Reduce index size while still enabling LIKE searches
--
-- 4. Monitor index usage with:
--    SELECT * FROM sys.schema_unused_indexes 
--    WHERE object_schema = 'cksurf';
--
-- 5. Remove indexes with count_read = 0 after sufficient usage period