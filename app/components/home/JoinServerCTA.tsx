import Link from '@/components/Link';
import { Play } from 'lucide-react';

/** Links to /servers, where players pick a server and join in one click. Deliberately shows no
 * player counts, so the front page never implies the servers are empty. */
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
