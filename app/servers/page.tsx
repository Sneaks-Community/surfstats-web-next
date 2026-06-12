import { Server } from 'lucide-react';
import { getServersFromCache, type ServerStatus } from '@/lib/valkey-server-cache';
import ServerCard from './ServerCard';
import logger from '@/lib/logger';
import type { Metadata } from 'next';
import { getErrorMessage } from '@/lib/errors';

// Force dynamic rendering to ensure fresh data on each request
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Servers',
};

export default async function ServersPage() {
  let servers: ServerStatus[] = [];
  
  try {
    servers = await getServersFromCache();
    logger.debug(`[Servers] Loaded ${servers.length} servers`);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);
    logger.error(`[Servers] Failed to load servers: ${errorMessage}`);
    logger.error('[Servers] Server list will be empty');
  }
  
  const mapImagesUrl = process.env.MAP_IMAGES_URL || 'https://image.gametracker.com/images/maps/160x120/csgo/';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-text">Live Servers</h1>
        <p className="text-text-muted">Current status of our community servers</p>
      </div>

      <div className="flex flex-col gap-4">
        {servers.map((server) => (
          <ServerCard key={`${server.config.ip}:${server.config.port}`} server={server} mapImagesUrl={mapImagesUrl} />
        ))}
        
        {servers.length === 0 && (
          <div className="text-center py-12 bg-surface border border-border rounded-xl">
            <Server className="h-12 w-12 text-text-muted mx-auto mb-4" />
            <h3 className="text-lg font-medium text-text">No servers configured</h3>
            <p className="text-text-muted mt-1">Please add servers to your configuration.</p>
          </div>
        )}
      </div>
    </div>
  );
}