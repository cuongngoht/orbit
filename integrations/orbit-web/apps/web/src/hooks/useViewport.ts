// Responsive viewport and pointer queries, backed by matchMedia via useSyncExternalStore so tests under jsdom
// default cleanly to desktop (all max-width and coarse-pointer queries match false unless mocked).
import { useEffect, useSyncExternalStore } from "react";

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
  /** True at 1440px and wider (a research session shows its three panels side by side). */
  isWide: boolean;
}

export function useViewport(): Viewport {
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isCompact = useMediaQuery("(max-width: 1023px)");
  const isNarrowDesktop = useMediaQuery("(max-width: 1279px)");
  const isCoarse = useMediaQuery("(pointer: coarse)");
  const isWide = useMediaQuery("(min-width: 1440px)");
  return {
    isMobile,
    isCompact,
    isTablet: !isMobile && isCompact,
    isNarrowDesktop,
    isCoarse,
    isWide,
  };
}

const APP_HEIGHT_VAR = "--orbit-app-height";
const APP_TOP_VAR = "--orbit-app-top";
const SAFE_BOTTOM_VAR = "--orbit-safe-bottom";
const KEYBOARD_THRESHOLD_PX = 120;
const PINCH_SCALE_THRESHOLD = 1.02;

function clearVisualViewportVars(style: CSSStyleDeclaration): void {
  style.removeProperty(APP_HEIGHT_VAR);
  style.removeProperty(APP_TOP_VAR);
  style.removeProperty(SAFE_BOTTOM_VAR);
}

// Keep the fixed shell aligned with window.visualViewport on touch/iOS browsers so opening the software
// keyboard shrinks the visible container instead of scrolling the header and tab bar out of sight.
export function useVisualViewport(enabled: boolean): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const rootStyle = document.documentElement.style;
    const vv = window.visualViewport;
    if (!enabled || !vv) {
      clearVisualViewportVars(rootStyle);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const sync = () => {
      if (vv.scale > PINCH_SCALE_THRESHOLD) {
        clearVisualViewportVars(rootStyle);
        return;
      }
      rootStyle.setProperty(APP_HEIGHT_VAR, `${Math.round(vv.height)}px`);
      rootStyle.setProperty(APP_TOP_VAR, `${Math.max(0, Math.round(vv.offsetTop))}px`);
      const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX;
      if (keyboardOpen) rootStyle.setProperty(SAFE_BOTTOM_VAR, "0px");
      else rootStyle.removeProperty(SAFE_BOTTOM_VAR);
    };

    const onFocusOut = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const tag = document.activeElement?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
          if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
          sync();
        }
      }, 100);
    };

    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    window.addEventListener("focusout", onFocusOut);

    return () => {
      if (timer !== null) clearTimeout(timer);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      window.removeEventListener("focusout", onFocusOut);
      clearVisualViewportVars(rootStyle);
    };
  }, [enabled]);
}
