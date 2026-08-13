import 'server-only';
import { GameDig } from 'gamedig';
import logger from '@/lib/logger';
import { cachedFetch } from './cached-fetch';
import { SERVER_CACHE_KEY, SERVER_CACHE_TTL } from './cache-keys';
import { getErrorMessage } from './errors';
import { getServerConfigs, type ServerConfig } from './env';

interface GameDigPlayer {
  name: string;
  raw?: Record<string, unknown>;
  time?: number;
  score?: number;
}

export interface Player {
  name: string;
  time?: number;
  score?: number;
}

export interface ServerStatus {
  config: ServerConfig;
  online: boolean;
  name?: string;
  map?: string;
  players?: number;
  maxplayers?: number;
  ping?: number;
  playerList?: Player[];
}

export async function fetchServersFromGame(): Promise<ServerStatus[]> {
  const startTime = Date.now();

  try {
    logger.debug('[ServerCache] Fetching server statuses...');
    const configs = getServerConfigs();

    logger.debug(`[ServerCache] Querying ${configs.length} servers...`);

    const statuses = await Promise.all(
      configs.map(async (config) => {
        const serverStart = Date.now();
        try {
          const state = await GameDig.query({
            type: 'csgo',
            host: config.ip,
            port: config.port,
            maxAttempts: 1,
            socketTimeout: 2000,
          });

          const duration = Date.now() - serverStart;
          logger.debug(`[ServerCache] Server ${config.name} responded in ${duration}ms`);

          return {
            config,
            online: true,
            name: state.name,
            map: state.map,
            players: state.players.length,
            maxplayers: state.maxplayers,
            ping: state.ping,
            playerList: state.players.map((p: GameDigPlayer) => ({
              name: p.name || '',
              time:
                typeof p.time === 'number'
                  ? p.time
                  : typeof p.raw?.time === 'number'
                  ? p.raw.time
                  : 0,
              score: p.score || 0,
            })),
          };
        } catch (error: unknown) {
          const err = error as { code?: string };
          const errorCode = err.code || 'UNKNOWN';
          logger.debug(`[ServerCache] Server ${config.name} offline: ${errorCode}`);
          return {
            config,
            online: false,
          };
        }
      })
    );

    const onlineCount = statuses.filter((s) => s.online).length;
    const duration = Date.now() - startTime;
    logger.debug(
      `[ServerCache] Fetched ${statuses.length} servers (${onlineCount} online) in ${duration}ms`
    );

    return statuses;
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    logger.error(`[ServerCache] Failed to fetch server statuses after ${duration}ms`);
    logger.error(`[ServerCache] Error: ${getErrorMessage(error)}`);
    return [];
  }
}

export async function getServersFromCache(): Promise<ServerStatus[]> {
  return cachedFetch(SERVER_CACHE_KEY, SERVER_CACHE_TTL, fetchServersFromGame, { lock: true });
}
