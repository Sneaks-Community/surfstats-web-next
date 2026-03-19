'use client';

import { useState } from 'react';
import { Server, Users, Map as MapIcon, Activity, ChevronDown, Clock } from 'lucide-react';
import Link from 'next/link';
import MapImage from '@/components/MapImage';

function formatTime(seconds?: number) {
  if (typeof seconds !== 'number' || isNaN(seconds)) return 'Unknown';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

export default function ServerCard({ server, mapImagesUrl }: { server: any; mapImagesUrl: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col transition-all">
      <button
        type="button"
        className={`px-4 py-3 flex items-center justify-between transition-colors w-full text-left ${server.online ? 'cursor-pointer hover:bg-zinc-800/50' : ''}`}
        onClick={() => server.online && setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls="server-details"
        disabled={!server.online}
      >
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-800/50 border border-zinc-700/50 shrink-0">
            <Server className={`h-5 w-5 ${server.online ? 'text-emerald-400' : 'text-zinc-600'}`} />
          </div>
          
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white">{server.config.name}</h2>
              <span className="relative flex h-2 w-2">
                {server.online ? (
                  <>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </>
                ) : (
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                )}
              </span>
            </div>
            <div className="text-xs text-zinc-500 font-mono mt-0.5">{server.config.ip}:{server.config.port}</div>
          </div>
        </div>
        
        {server.online ? (
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="hidden sm:block text-right">
              <Link href={`/maps/${server.map}`} className="text-sm font-medium text-emerald-400 hover:underline block" onClick={(e) => e.stopPropagation()}>
                {server.map}
              </Link>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">Map</div>
            </div>
            
            <div className="hidden sm:block text-right">
              <div className="text-sm font-medium text-white">
                {server.players} <span className="text-zinc-500">/ {server.maxplayers}</span>
              </div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">Players</div>
            </div>
            
            <div className="flex items-center gap-3">
              <a 
                href={`steam://connect/${server.config.ip}:${server.config.port}`}
                className="px-3 py-1.5 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-600/20 rounded-md text-sm font-medium transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                Connect
              </a>
              <ChevronDown className={`h-5 w-5 text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
        ) : (
          <div className="text-sm font-medium text-zinc-500 uppercase tracking-wider">
            Offline
          </div>
        )}
      </button>
      
      {expanded && server.online && (
        <div className="border-t border-zinc-800 bg-zinc-900/30">
          {/* Mobile-only stats row */}
          <div className="sm:hidden flex items-center justify-between p-4 border-b border-zinc-800/50 bg-zinc-800/20">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Map</div>
              <Link href={`/maps/${server.map}`} className="text-sm font-medium text-emerald-400 hover:underline">
                {server.map}
              </Link>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Players</div>
              <div className="text-sm font-medium text-white">
                {server.players} <span className="text-zinc-500">/ {server.maxplayers}</span>
              </div>
            </div>
          </div>
          
          {/* Map Image Section */}
          <div className="p-4 border-b border-zinc-800/50">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <Link href={`/maps/${server.map}`} className="relative h-24 w-40 rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-800 flex-shrink-0 hover:border-emerald-500/50 transition-colors">
                <MapImage
                  src={`${mapImagesUrl}${server.map}.jpg`}
                  alt={server.map}
                  fill
                  className="object-cover"
                  referrerPolicy="no-referrer"
                />
              </Link>
              <div className="flex-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Current Map</div>
                <Link href={`/maps/${server.map}`} className="text-lg font-semibold text-emerald-400 hover:underline">
                  {server.map}
                </Link>
              </div>
            </div>
          </div>
          
          <div className="p-4">
            <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
              <Users className="h-4 w-4" />
              Connected Players
            </h3>
            
            {server.playerList && server.playerList.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {server.playerList.map((player: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-zinc-800/40 rounded p-2 border border-zinc-700/30">
                    <span className="text-sm text-zinc-200 truncate pr-2 font-medium">
                      {player.name || 'Connecting...'}
                    </span>
                    <div className="flex items-center gap-1 text-xs text-zinc-500 shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatTime(player.time)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-500 italic py-2">No players currently online.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
