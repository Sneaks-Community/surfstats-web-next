'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

// `useLayoutEffect` warns during SSR; fall back to `useEffect` on the server
// (where it's a no-op anyway) and use the layout variant in the browser so the
// reserved height is applied synchronously, before the browser can repaint.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface NavigationPendingContextValue {
  /** True from the moment a navigation is triggered until the new content commits. */
  isPending: boolean;
  /** Navigate client-side inside a transition so `isPending` flips immediately. */
  navigate: (url: string) => void;
}

const NavigationPendingContext = createContext<NavigationPendingContextValue | null>(null);

/**
 * Provides client-side navigation with an immediate pending flag.
 *
 * Next.js `<Link>` navigations run inside a React transition, so the router
 * keeps the current UI on screen (and suppresses Suspense fallbacks) until the
 * server responds. For a search-param change backed by a slow query that means
 * no loading feedback until the data is basically ready. Routing through
 * `useTransition` here exposes `isPending` the instant the user clicks, so a
 * wrapper can show a skeleton right away.
 */
export function NavigationPendingProvider({ children }: { children: ReactNode }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const navigate = useCallback(
    (url: string) => {
      startTransition(() => {
        router.push(url, { scroll: false });
      });
    },
    [router]
  );

  return (
    <NavigationPendingContext.Provider value={{ isPending, navigate }}>
      {children}
    </NavigationPendingContext.Provider>
  );
}

/** Returns the pending context, or null when rendered outside a provider. */
export function useNavigationPending(): NavigationPendingContextValue | null {
  return useContext(NavigationPendingContext);
}

/**
 * Renders `fallback` while a navigation triggered through the provider is in
 * flight, otherwise renders `children`. Placed around a list/grid it swaps in a
 * skeleton the instant the user paginates, instead of waiting for the server.
 *
 * While pending, the wrapper is pinned to the height the real content had just
 * before the swap. Skeletons are almost always shorter than the content they
 * replace (fewer/relaxed rows, no pagination footer, …); without this the
 * document would shrink mid-navigation, the browser would clamp the scroll
 * offset to the new (smaller) max height, and the user would be yanked toward
 * the top even though the navigation itself preserves scroll. Reserving the
 * height keeps them exactly where they were.
 */
export function PendingContent({
  children,
  fallback,
  className,
}: {
  children: ReactNode;
  fallback: ReactNode;
  /** Applied to the wrapper element (e.g. spacing utilities the children rely on). */
  className?: string;
}) {
  const nav = useNavigationPending();
  const isPending = nav?.isPending ?? false;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef<number>(0);
  const [reservedHeight, setReservedHeight] = useState<number | undefined>(undefined);

  // On entering the pending state, pin the wrapper to the height the real
  // content had on its last settled render; on leaving it, remeasure and drop
  // the reservation. Runs before paint so the browser never sees the shorter
  // skeleton and never clamps the scroll offset.
  useIsomorphicLayoutEffect(() => {
    if (isPending) {
      setReservedHeight(lastHeight.current || undefined);
    } else {
      if (wrapperRef.current) lastHeight.current = wrapperRef.current.offsetHeight;
      setReservedHeight(undefined);
    }
  }, [isPending]);

  return (
    <div
      ref={wrapperRef}
      className={className}
      style={isPending && reservedHeight ? { minHeight: reservedHeight } : undefined}
    >
      {isPending ? fallback : children}
    </div>
  );
}
