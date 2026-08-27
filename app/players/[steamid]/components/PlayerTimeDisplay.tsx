"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { formatPlaytime, formatPlaytimeToggle } from "@/lib/utils";

interface PlayerTimeDisplayProps {
  totalSeconds: number;
}

export default function PlayerTimeDisplay({ totalSeconds }: PlayerTimeDisplayProps) {
  const [showDays, setShowDays] = useState(true);

  return (
    <button
      type="button"
      className="bg-surface border border-border rounded-xl p-3 flex flex-col items-center justify-center md:col-start-4 md:col-span-1 cursor-pointer hover:bg-surface-hover transition-colors"
      onClick={() => setShowDays(!showDays)}
      aria-label={`Time played, showing ${showDays ? 'days' : 'hours'}. Activate to switch.`}
    >
      <Clock className="w-8 h-8 text-purple-500 mb-2" />
      <span className="text-2xl font-bold text-text">
        {showDays ? formatPlaytime(totalSeconds) : formatPlaytimeToggle(totalSeconds)}
      </span>
      <span className="text-xs text-text-muted">Time Played</span>
    </button>
  );
}
