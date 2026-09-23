'use client';

import { useId, useRef, useState } from 'react';
import { Users, ChevronRight, Clock, Check, Copy, X, Mountain } from 'lucide-react';
import Link from '@/components/Link';
import MapImage from '@/components/MapImage';
import { getTierColor } from '@/lib/tierColors';
import { isSurfMap, mapImageUrl } from '@/lib/utils';
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

/** Dimmed map image fading into the surface color, so text keeps the theme colors. */
function MapBackdrop({ src }: { src: string }) {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {/* Keyed so a new map retries after the previous image 404'd. */}
      <MapImage
        key={src}
        src={src}
        alt=""
        unoptimized
        fill
        loading="eager"
        className="object-cover opacity-60"
        referrerPolicy="no-referrer"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-surface from-40% to-surface/40" />
    </div>
  );
}

function StatusDot({ server }: { server: ServerStatus }) {
  if (!server.online) return <span className="inline-flex rounded-full h-2 w-2 bg-red-500 shrink-0" />;
  const color = (server.players ?? 0) < (server.maxplayers ?? 0) ? 'bg-green-500' : 'bg-yellow-500';
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`}></span>
      <span className={`relative inline-flex rounded-full h-2 w-2 ${color}`}></span>
    </span>
  );
}

function MapLabel({ map, tier }: { map?: string; tier: number | null }) {
  const tierColor = tier === null ? null : getTierColor(tier);
  return (
    <div className="flex items-center gap-2 min-w-0">
      {isSurfMap(map) ? (
        <Link href={`/maps/${map}`} className="pointer-events-auto truncate text-sm font-medium text-primary hover:underline">
          {map}
        </Link>
      ) : (
        <span className={`truncate text-sm font-medium ${map ? 'text-text' : 'text-text-muted'}`}>
          {map ?? 'Unknown map'}
        </span>
      )}
      {/* TierBadge is 30px tall; this stays on the 20px text line so cards keep one height. */}
      {tierColor && (
        <span
          className={`inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-xs font-bold uppercase tracking-wider ${tierColor.bg} ${tierColor.text} ${tierColor.border}`}
        >
          <Mountain className="h-3 w-3" />T{tier}
        </span>
      )}
    </div>
  );
}

export default function ServerCard({
  server,
  tier,
  mapImagesUrl,
}: {
  server: ServerStatus;
  tier: number | null;
  mapImagesUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const address = `${server.config.ip}:${server.config.port}`;
  const players = server.playerList ?? [];
  const hasPlayers = server.online && players.length > 0;
  // gamedig can report an online server with no current map.
  const backdropSrc = server.online && server.map ? mapImageUrl(mapImagesUrl, server.map) : null;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context); silently ignore
    }
  };

  const connect = (
    <a
      href={`steam://connect/${address}`}
      className="pointer-events-auto hidden sm:inline-flex px-3 py-1.5 bg-surface hover:bg-surface-hover text-primary border border-primary/40 rounded-md text-sm font-medium transition-colors"
    >
      Connect
    </a>
  );

  return (
    <>
      <div
        className={`relative bg-surface border border-border rounded-xl overflow-hidden transition-colors ${hasPlayers ? 'hover:border-primary/50' : ''}`}
      >
        {backdropSrc && <MapBackdrop src={backdropSrc} />}
        {/* Stretched trigger: keeps the whole card clickable without nesting
            the copy/connect controls inside a button. */}
        {hasPlayers && (
          <button
            type="button"
            className="absolute inset-0 w-full rounded-xl cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            onClick={() => dialogRef.current?.showModal()}
            aria-haspopup="dialog"
          >
            <span className="sr-only">Show players on {server.config.name}</span>
          </button>
        )}
        <div className="relative pointer-events-none p-3 flex justify-between gap-3">
          <div className="min-w-0 flex flex-col gap-1">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot server={server} />
              <h2 className="truncate text-base font-semibold text-text">{server.config.name}</h2>
            </div>
            {server.online ? (
              <MapLabel map={server.map} tier={tier} />
            ) : (
              <div className="text-sm font-medium uppercase tracking-wider text-text-muted">Offline</div>
            )}
            <button
              type="button"
              onClick={() => void copyAddress()}
              title="Copy address to clipboard"
              aria-label={copied ? 'Address copied to clipboard' : `Copy ${address} to clipboard`}
              className="group self-start pointer-events-auto inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text font-mono transition-colors cursor-pointer"
            >
              <span>{address}</span>
              {copied ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </button>
          </div>
          {server.online && (
            <div className="flex flex-col items-end justify-between shrink-0">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-surface/80 px-2 py-0.5 text-sm font-medium text-text tabular-nums">
                <Users className="h-3.5 w-3.5 text-text-muted" />
                {server.players} <span className="text-text-muted">/ {server.maxplayers}</span>
              </span>
              <div className="flex items-center gap-2">
                {connect}
                {hasPlayers && <ChevronRight className="h-5 w-5 rounded bg-surface/80 text-text-muted" />}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* A sibling, not a child: hovering the open dialog would otherwise
          highlight the card's border through the backdrop. */}
      {hasPlayers && (
        <dialog
          ref={dialogRef}
          closedby="any"
          aria-labelledby={titleId}
          className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border bg-surface text-text shadow-2xl backdrop:bg-background/70 backdrop:backdrop-blur-sm"
        >
          {/* Layout lives here: `flex` on the dialog would override its closed display:none. */}
          <div className="flex max-h-[85dvh] flex-col">
            <div className="relative shrink-0 border-b border-border">
              {backdropSrc && <MapBackdrop src={backdropSrc} />}
              <div className="relative flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <StatusDot server={server} />
                    <h2 id={titleId} className="truncate text-lg font-semibold text-text">
                      {server.config.name}
                    </h2>
                  </div>
                  <MapLabel map={server.map} tier={tier} />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {connect}
                  <button
                    type="button"
                    onClick={() => dialogRef.current?.close()}
                    aria-label="Close"
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-surface/80 text-text-muted hover:bg-surface-hover hover:text-text transition-colors cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="min-h-0 overflow-y-auto p-4">
              <h3 className="text-sm font-medium text-text-muted mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                {server.players} / {server.maxplayers} players
              </h3>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {players.map((player: Player, idx: number) => (
                  <li key={idx} className="flex items-center justify-between bg-surface-hover/40 rounded p-2 border border-border/30">
                    <span className="text-sm text-text truncate pr-2 font-medium">
                      {player.name || 'Connecting...'}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-text-muted shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatTime(player.time)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
