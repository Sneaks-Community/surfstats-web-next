'use client';

import { useState } from 'react';
import { Server, Users, ChevronDown, Clock, Check, Copy } from 'lucide-react';
import Link from '@/components/Link';
import MapImage from '@/components/MapImage';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import { mapImageUrl } from '@/lib/utils';
import type { ServerStatus, Player } from '@/lib/server-status';

function formatTime(seconds?: number) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return 'Unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

/** Links the thumbnail only when the server reported a map. */
function MapThumb({ href, className, children }: { href: string | null; className: string; children: React.ReactNode }) {
  if (!href) return <div className={className}>{children}</div>;
  return <Link href={href} className={className}>{children}</Link>;
}

export default function ServerCard({ server, mapImagesUrl }: { server: ServerStatus; mapImagesUrl: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const address = `${server.config.ip}:${server.config.port}`;
  // gamedig can report an online server with no current map; a link built from
  // it lands on /maps/undefined.
  const mapHref = server.map ? `/maps/${server.map}` : null;
  // Unique per card so aria-controls resolves and ids don't collide across cards.
  const panelId = `server-details-${server.config.ip}-${server.config.port}`;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — silently ignore
    }
  };

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col transition-all">
      <div className={`relative px-4 py-3 flex items-center justify-between transition-colors ${server.online ? 'cursor-pointer hover:bg-surface-hover/50' : ''}`}>
        {/* Stretched toggle: keeps the whole header clickable without nesting
            the copy/connect controls inside a button. */}
        {server.online && (
          <button
            type="button"
            className="absolute inset-0 w-full"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={panelId}
          >
            <span className="sr-only">
              {expanded ? 'Hide' : 'Show'} details for {server.config.name}
            </span>
          </button>
        )}
        <div className="relative flex items-center gap-4 pointer-events-none">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-surface-hover/50 border border-border/50 shrink-0">
            <Server className={`h-5 w-5 ${server.online ? 'text-primary' : 'text-text-placeholder'}`} />
          </div>
          
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text">{server.config.name}</h2>
              <span className="relative flex h-2 w-2">
                {server.online ? (
                  (server.players ?? 0) < (server.maxplayers ?? 0) ? (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                    </>
                  ) : (
                    <>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-500 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500"></span>
                    </>
                  )
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => void copyAddress()}
              title="Copy address to clipboard"
              aria-label={copied ? 'Address copied to clipboard' : `Copy ${address} to clipboard`}
              className="group pointer-events-auto inline-flex items-center gap-1.5 text-xs text-text-placeholder hover:text-text font-mono mt-0.5 transition-colors cursor-pointer"
            >
              <span>{address}</span>
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </button>
          </div>
        </div>
        
        {server.online ? (
          <div className="relative flex items-center gap-4 sm:gap-6 pointer-events-none">
            <div className="hidden sm:block text-right">
              {server.map ? (
                <MapLinkWithPreview mapname={server.map} className="pointer-events-auto text-sm font-medium text-primary hover:underline block">
                  {server.map}
                </MapLinkWithPreview>
              ) : (
                <span className="text-sm font-medium text-text-placeholder">Unknown Map</span>
              )}
              <div className="text-[10px] uppercase tracking-wider text-text-placeholder mt-0.5">Map</div>
            </div>
            
            <div className="hidden sm:block text-right">
              <div className="text-sm font-medium text-text">
                {server.players} <span className="text-text-placeholder">/ {server.maxplayers}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-text-placeholder mt-0.5">Players</div>
            </div>
            
            <div className="flex items-center gap-3">
              <a
                href={`steam://connect/${server.config.ip}:${server.config.port}`}
                className="pointer-events-auto hidden sm:inline-flex px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-md text-sm font-medium transition-colors"
              >
                Connect
              </a>
              <ChevronDown className={`h-5 w-5 text-text-placeholder transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
        ) : (
          <div className="relative text-sm font-medium text-text-placeholder uppercase tracking-wider">
            Offline
          </div>
        )}
      </div>
      
      {expanded && server.online && (
        <div id={panelId} className="border-t border-border bg-surface/30">
          {/* Mobile-only stats row */}
          <div className="sm:hidden flex items-center justify-between p-4 border-b border-border/50 bg-surface-hover/20">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-placeholder mb-1">Map</div>
              {server.map ? (
                <Link href={`/maps/${server.map}`} className="text-sm font-medium text-primary hover:underline">
                  {server.map}
                </Link>
              ) : (
                <span className="text-sm font-medium text-text-placeholder">Unknown</span>
              )}
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-text-placeholder mb-1">Players</div>
              <div className="text-sm font-medium text-text">
                {server.players} <span className="text-text-placeholder">/ {server.maxplayers}</span>
              </div>
            </div>
          </div>
          
          {/* Map Image Section */}
          <div className="p-4 border-b border-border/50">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <MapThumb href={mapHref} className="relative h-24 w-40 rounded-lg overflow-hidden border border-border/50 bg-surface-hover flex-shrink-0 hover:border-primary/50 transition-colors">
                <MapImage
                  src={mapImageUrl(mapImagesUrl, server.map)}
                  alt={server.map ?? 'Unknown Map'}
                  unoptimized
                  fill
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              </MapThumb>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-text-placeholder mb-1">Current Map</div>
                {server.map ? (
                  <Link href={`/maps/${server.map}`} className="text-lg font-semibold text-primary hover:underline">
                    {server.map}
                  </Link>
                ) : (
                  <span className="text-lg font-semibold text-text-placeholder">Unknown Map</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="p-4">
            <h3 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Connected Players
            </h3>
            
            {server.playerList && server.playerList.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {server.playerList.map((player: Player, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-surface-hover/40 rounded p-2 border border-border/30">
                    <span className="text-sm text-text truncate pr-2 font-medium">
                      {player.name || 'Connecting...'}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-text-placeholder shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatTime(player.time)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-text-placeholder italic py-2">No players currently online.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}