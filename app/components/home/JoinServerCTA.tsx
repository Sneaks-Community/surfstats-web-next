import Link from '@/components/Link';
import { Play } from 'lucide-react';

/**
 * Prominent "Play Now" call to action. Links to the Servers page — the clearest
 * path into the game — where players can pick a server and one-click join.
 * Deliberately renders NO player counts here, so the front page entices without
 * implying the servers are empty.
 */
export default function JoinServerCTA() {
  return (
    <Link
      href="/servers"
      className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-white font-semibold shadow-sm hover:opacity-90 transition-opacity shrink-0"
    >
      <Play className="h-5 w-5 fill-current" />
      Play Now
    </Link>
  );
}
