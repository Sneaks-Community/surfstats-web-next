'use client';

import { useState } from 'react';
import { Server, Users, ChevronDown, Clock } from 'lucide-react';
import Link from 'next/link';
import MapImage from '@/components/MapImage';
import MapLinkWithPreview from '@/components/MapLinkWithPreview';
import type { ServerStatus, Player } from '@/lib/cache';

function formatTime(seconds?: number) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return 'Unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

export default function ServerCard({ server, mapImagesUrl }: { server: ServerStatus; mapImagesUrl: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col transition-all">
      <button
        type="button"
        className={`px-4 py-3 flex items-center justify-between transition-colors w-full text-left ${server.online ? 'cursor-pointer hover:bg-surface-hover/50' : ''}`}
        onClick={() => server.online && setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="server-details"
        disabled={!server.online}
      >
        <div className="flex items-center gap-4">
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
            <div className="text-xs text-text-placeholder font-mono mt-0.5">{server.config.ip}:{server.config.port}</div>
          </div>
        </div>
        
        {server.online ? (
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="hidden sm:block text-right">
              <MapLinkWithPreview mapname={server.map ?? 'unknown'} className="text-sm font-medium text-primary hover:underline block" onClick={(e) => e.stopPropagation()}>
                {server.map ?? 'Unknown Map'}
              </MapLinkWithPreview>
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
                className="hidden sm:inline-flex px-3 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-md text-sm font-medium transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                Connect
              </a>
              <ChevronDown className={`h-5 w-5 text-text-placeholder transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
        ) : (
          <div className="text-sm font-medium text-text-placeholder uppercase tracking-wider">
            Offline
          </div>
        )}
      </button>
      
      {expanded && server.online && (
        <div className="border-t border-border bg-surface/30">
          {/* Mobile-only stats row */}
          <div className="sm:hidden flex items-center justify-between p-4 border-b border-border/50 bg-surface-hover/20">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-placeholder mb-1">Map</div>
              <Link href={`/maps/${server.map}`} className="text-sm font-medium text-primary hover:underline">
                {server.map}
              </Link>
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
              <Link href={`/maps/${server.map}`} className="relative h-24 w-40 rounded-lg overflow-hidden border border-border/50 bg-surface-hover flex-shrink-0 hover:border-primary/50 transition-colors">
                <MapImage
                  src={`${mapImagesUrl}${server.map}.jpg`}
                  alt={server.map ?? 'Unknown Map'}
                  unoptimized
                  fill
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              </Link>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-text-placeholder mb-1">Current Map</div>
                <Link href={`/maps/${server.map}`} className="text-lg font-semibold text-primary hover:underline">
                  {server.map}
                </Link>
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