import { Server } from 'lucide-react';
import { getServersCached } from '@/lib/cache';
import ServerCard from './ServerCard';
import logger from '@/lib/logger';

interface Player {
  name: string;
  raw?: any;
  time?: number;
  score?: number;
}

interface ServerStatus {
  config: {
    name: string;
    ip: string;
    port: number;
  };
  online: boolean;
  name?: string;
  map?: string;
  players?: number;
  maxplayers?: number;
  ping?: number;
  playerList?: Player[];
}

export default async function ServersPage() {
  let servers: ServerStatus[] = [];
  
  try {
    servers = await getServersCached();
    logger.debug(`[Servers] Loaded ${servers.length} servers`);
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    logger.error(`[Servers] Failed to load servers: ${errorMessage}`);
    logger.error('[Servers] Server list will be empty');
  }
  
  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Live Servers</h1>
        <p className="text-zinc-400">Current status of our community servers</p>
      </div>

      <div className="flex flex-col gap-4">
        {servers.map((server) => (
          <ServerCard key={`${server.config.ip}:${server.config.port}`} server={server} mapImagesUrl={mapImagesUrl} />
        ))}
        
        {servers.length === 0 && (
          <div className="text-center py-12 bg-zinc-900 border border-zinc-800 rounded-xl">
            <Server className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-white">No servers configured</h3>
            <p className="text-zinc-400 mt-1">Please add servers to your configuration.</p>
          </div>
        )}
      </div>
    </div>
  );
}