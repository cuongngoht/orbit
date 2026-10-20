import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { useMediaQuery } from "../../shared/hooks/useMediaQuery";

// Three shapes, one decision:
//
//   expanded   wide window, labels shown (the default)
//   rail       wide window, collapsed to icons -- remembered across visits
//   overlay    narrow window: hidden until the menu button opens it over the
//              page, and closed again the moment a page is chosen
//
// The rail keeps every page one click away without its labels, which is what
// lets the list grow without the sidebar getting in the way.
export type SidebarMode = "expanded" | "rail" | "overlay";

export const NARROW = "(max-width: 767px)";
const KEY = "orbit.control.sidebar";

export interface Sidebar {
  mode: SidebarMode;
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export function useSidebar(): Sidebar {
  const narrow = useMediaQuery(NARROW);
  const [expanded, setExpanded] = useState(() => window.localStorage.getItem(KEY) !== "rail");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOverlayOpen(false), [pathname, narrow]);
  const toggle = () => (narrow ? setOverlayOpen(!overlayOpen) : remember(!expanded, setExpanded));
  return { mode: narrow ? "overlay" : expanded ? "expanded" : "rail", open: narrow ? overlayOpen : true, toggle, close: () => setOverlayOpen(false) };
}

function remember(expanded: boolean, set: (expanded: boolean) => void) {
  window.localStorage.setItem(KEY, expanded ? "expanded" : "rail");
  set(expanded);
}
