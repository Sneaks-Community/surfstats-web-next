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

// `useLayoutEffect` warns in SSR; the browser needs it so the reserved height lands before paint.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

interface NavigationPendingContextValue {
  /** True from the moment a navigation is triggered until the new content commits. */
  isPending: boolean;
  /** Navigate client-side inside a transition so `isPending` flips immediately. */
  navigate: (url: string) => void;
}

const NavigationPendingContext = createContext<NavigationPendingContextValue | null>(null);

/** Client navigation whose `isPending` flips on click, so a wrapper can show a skeleton at once;
 * a `<Link>` transition keeps the old UI (no Suspense fallback) until the server responds. */
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

/** The pending context, or null outside a provider. */
export function useNavigationPending(): NavigationPendingContextValue | null {
  return useContext(NavigationPendingContext);
}

/** Renders `fallback` during a provider navigation, else `children`, held at the content's last
 * height: a shorter skeleton would shrink the page and make the browser clamp the scroll upward. */
export function PendingContent({
  children,
  fallback,
  className,
}: {
  children: ReactNode;
  fallback: ReactNode;
  /** Wrapper classes, e.g. spacing utilities the children rely on. */
  className?: string;
}) {
  const nav = useNavigationPending();
  const isPending = nav?.isPending ?? false;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastHeight = useRef<number>(0);
  const [reservedHeight, setReservedHeight] = useState<number | undefined>(undefined);

  // Entering pending: pin to the last settled height. Leaving: remeasure and unpin.
  // Before paint, so the browser never sees the shorter skeleton and never clamps the scroll.
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
