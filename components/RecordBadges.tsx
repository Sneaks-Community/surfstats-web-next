/** Small "B{n}" badge for a bonus zone group. */
export function ZoneGroupBadge({ zonegroup }: { zonegroup: number }) {
  return (
    <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">
      B{zonegroup}
    </span>
  );
}

/** Small "S{n}" badge for a stage. */
export function StageBadge({ stage }: { stage: number }) {
  return (
    <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
      S{stage}
    </span>
  );
}
