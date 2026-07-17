'use client';

import {
  createContext,
  useCallback,
  useContext,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

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
 */
export function PendingContent({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const nav = useNavigationPending();
  return <>{nav?.isPending ? fallback : children}</>;
}
