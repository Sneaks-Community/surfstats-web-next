-- SurfStats Web: one-time setup for a stock PlayerAnalytics database.
-- Adds the two indexes this app's queries need, then the player_analytics_summary
-- table that the play-time display reads.
--
--   mysql -u USER -p player_analytics_surf < sql/player_analytics_setup.sql
--
-- Needs the mysql CLI (DELIMITER is a client directive). MySQL 5.7+ / MariaDB 10+.
-- Safe to re-run. Online DDL, but minutes per step on millions of rows: run it quiet.

-- ============================================================================
-- Indexes
-- ============================================================================

-- Map time-on-server graph: WHERE map = ? GROUP BY month(connect_date).
-- No stock index leads with `map`, so today it scans the whole table, once per
-- map per daily graph sweep. Covering.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'player_analytics'
       AND index_name = 'idx_player_analytics_map_connect_date') > 0,
  'SELECT ''skip: idx_player_analytics_map_connect_date exists'' AS step',
  'ALTER TABLE `player_analytics`
     ADD INDEX `idx_player_analytics_map_connect_date` (`map`, `connect_date`, `duration`)');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Activity heatmap: WHERE steamid3 = ? ORDER BY connect_time DESC.
-- The stock `steamid3` index lacks connect_time, costing a row lookup per match
-- plus a filesort.
SET @ddl = IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'player_analytics'
       AND index_name = 'idx_player_analytics_steamid3_connect_time') > 0,
  'SELECT ''skip: idx_player_analytics_steamid3_connect_time exists'' AS step',
  'ALTER TABLE `player_analytics`
     ADD INDEX `idx_player_analytics_steamid3_connect_time` (`steamid3`, `connect_time`)');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Stock `steamid3` is now a strict prefix of the index above. Conditional on the
-- replacement existing, so an interrupted build does not leave the column bare.
SET @ddl = IF(
  (SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'player_analytics'
       AND index_name IN ('steamid3', 'idx_player_analytics_steamid3_connect_time')) = 2,
  'ALTER TABLE `player_analytics` DROP INDEX `steamid3`',
  'SELECT ''skip: steamid3 already dropped, or replacement missing'' AS step');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================================
-- Summary table
-- ============================================================================
-- Without it, play-time reads as unavailable; the app has no raw-SUM fallback.
--
-- `steamid3` and `duration` are both NULLable: PlayerAnalytics inserts on connect
-- with a NULL duration and fills it on disconnect. Under STRICT_TRANS_TABLES an
-- unguarded trigger pushes that NULL into a NOT NULL column and fails the game
-- server's own INSERT, so keep every guard below.

CREATE TABLE IF NOT EXISTS `player_analytics_summary` (
  `steamid3` int(11) NOT NULL,
  `total_duration` int(11) NOT NULL DEFAULT 0 COMMENT 'Total seconds played',
  `connection_count` int(11) NOT NULL DEFAULT 0,
  `last_updated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`steamid3`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfill. Upsert, so re-running just recomputes.
INSERT INTO `player_analytics_summary` (`steamid3`, `total_duration`, `connection_count`)
SELECT `steamid3`, COALESCE(SUM(`duration`), 0), COUNT(*)
FROM `player_analytics`
WHERE `steamid3` IS NOT NULL
GROUP BY `steamid3`
ON DUPLICATE KEY UPDATE
  `total_duration`   = VALUES(`total_duration`),
  `connection_count` = VALUES(`connection_count`);

DELIMITER //

-- A session in progress counts as a connection with 0 seconds; the update
-- trigger adds the real duration on disconnect.
DROP TRIGGER IF EXISTS `after_player_analytics_insert`//
CREATE DEFINER = CURRENT_USER TRIGGER `after_player_analytics_insert`
AFTER INSERT ON `player_analytics`
FOR EACH ROW
BEGIN
  IF NEW.`steamid3` IS NOT NULL THEN
    INSERT INTO `player_analytics_summary` (`steamid3`, `total_duration`, `connection_count`)
    VALUES (NEW.`steamid3`, COALESCE(NEW.`duration`, 0), 1)
    ON DUPLICATE KEY UPDATE
      `total_duration`   = `total_duration` + COALESCE(NEW.`duration`, 0),
      `connection_count` = `connection_count` + 1;
  END IF;
END//

DROP TRIGGER IF EXISTS `after_player_analytics_update`//
CREATE DEFINER = CURRENT_USER TRIGGER `after_player_analytics_update`
AFTER UPDATE ON `player_analytics`
FOR EACH ROW
BEGIN
  -- `<=>` not `!=`: NULL != 5 is NULL, which would drop every disconnect.
  IF NEW.`steamid3` IS NOT NULL AND NOT (OLD.`duration` <=> NEW.`duration`) THEN
    UPDATE `player_analytics_summary`
    SET `total_duration` = `total_duration`
                         - COALESCE(OLD.`duration`, 0)
                         + COALESCE(NEW.`duration`, 0)
    WHERE `steamid3` = NEW.`steamid3`;
  END IF;
END//

-- Rebuild from scratch after an interrupted backfill, or if the triggers were
-- ever missing while connections were recorded.
DROP PROCEDURE IF EXISTS `refresh_player_analytics_summary`//
CREATE DEFINER = CURRENT_USER PROCEDURE `refresh_player_analytics_summary`()
BEGIN
  DECLARE start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  DROP TEMPORARY TABLE IF EXISTS `temp_summary`;
  CREATE TEMPORARY TABLE `temp_summary` LIKE `player_analytics_summary`;

  INSERT INTO `temp_summary` (`steamid3`, `total_duration`, `connection_count`)
  SELECT `steamid3`, COALESCE(SUM(`duration`), 0), COUNT(*)
  FROM `player_analytics`
  WHERE `steamid3` IS NOT NULL
  GROUP BY `steamid3`;

  -- TRUNCATE auto-commits, so triggers can land rows before the restore: upsert.
  TRUNCATE TABLE `player_analytics_summary`;
  INSERT INTO `player_analytics_summary` SELECT * FROM `temp_summary`
  ON DUPLICATE KEY UPDATE
    `total_duration`   = VALUES(`total_duration`),
    `connection_count` = VALUES(`connection_count`);
  DROP TEMPORARY TABLE `temp_summary`;

  SELECT CONCAT('Refreshed in ', TIMESTAMPDIFF(SECOND, start_time, CURRENT_TIMESTAMP), 's') AS status;
END//

DELIMITER ;

-- ============================================================================
-- Verify
-- ============================================================================

SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS cols
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'player_analytics'
GROUP BY index_name;

SELECT COUNT(*) AS summary_players,
       (SELECT COUNT(DISTINCT steamid3) FROM `player_analytics`) AS expected
FROM `player_analytics_summary`;

SELECT trigger_name FROM information_schema.triggers
WHERE trigger_schema = DATABASE() AND event_object_table = 'player_analytics';
