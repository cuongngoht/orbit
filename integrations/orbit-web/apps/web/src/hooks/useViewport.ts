// Responsive viewport and pointer queries, backed by matchMedia via useSyncExternalStore so tests under jsdom
// default cleanly to desktop (all max-width and coarse-pointer queries match false unless mocked).
import { useSyncExternalStore } from "react";

const SERVER_DEFAULT = false;

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", onStoreChange);
        return () => mql.removeEventListener("change", onStoreChange);
      }
      mql.addListener(onStoreChange);
      return () => mql.removeListener(onStoreChange);
    },
    () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : SERVER_DEFAULT),
    () => SERVER_DEFAULT,
  );
}

export interface Viewport {
  /** True below 640px (phone portrait). */
  isMobile: boolean;
  /** True below 1024px (phone + tablet: sidebar uses overlay drawer). */
  isCompact: boolean;
  /** True between 640px and 1023px (tablet). */
  isTablet: boolean;
  /** True below 1280px (inspector uses overlay drawer instead of split pane). */
  isNarrowDesktop: boolean;
  /** True on touch-primary devices (pointer: coarse). */
  isCoarse: boolean;
}

export function useViewport(): Viewport {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const isNarrowDesktop = useMediaQuery("(max-width: 1279px)");
  const isCoarse = useMediaQuery("(pointer: coarse)");
  return {
    isMobile,
    isCompact,
    isTablet: !isMobile && isCompact,
    isNarrowDesktop,
    isCoarse,
  };
}
