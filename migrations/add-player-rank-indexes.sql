-- Performance indexes for player rank queries
-- These indexes optimize the count-based rank calculations

-- For ck_playertimes (map rankings)
-- Speeds up: COUNT(*) WHERE mapname = ? AND runtimepro < ?
CREATE INDEX idx_playertimes_mapname_runtime ON ck_playertimes(mapname, runtimepro);

-- Speeds up: WHERE steamid = ? ORDER BY mapname
CREATE INDEX idx_playertimes_steamid_mapname ON ck_playertimes(steamid, mapname);

-- For ck_bonus (bonus rankings)
-- Speeds up: COUNT(*) WHERE mapname = ? AND zonegroup = ? AND runtime < ?
CREATE INDEX idx_bonus_map_zone_runtime ON ck_bonus(mapname, zonegroup, runtime);

-- Speeds up: WHERE steamid = ? ORDER BY mapname, zonegroup
CREATE INDEX idx_bonus_steamid_map_zone ON ck_bonus(steamid, mapname, zonegroup);

-- For ck_stages (stage rankings)
-- Speeds up: COUNT(*) WHERE map = ? AND stage = ? AND runtime < ?
CREATE INDEX idx_stages_map_stage_runtime ON ck_stages(map, stage, runtime);

-- Speeds up: WHERE steamid = ? ORDER BY map, stage
CREATE INDEX idx_stages_steamid_map_stage ON ck_stages(steamid, map, stage);

-- For world record queries (MIN runtime per map)
-- Speeds up: SELECT mapname, MIN(runtimepro) FROM ck_playertimes GROUP BY mapname
CREATE INDEX idx_playertimes_mapname_min_runtime ON ck_playertimes(mapname, runtimepro);