import { AppItem, Button, Hamburger, NavDrawer, NavDrawerBody, NavDrawerFooter, NavDrawerHeader, NavItem, NavSectionHeader, Tooltip, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "react-router";
import { useFollow } from "../../shared/navigation/useFollow";
import { DESTINATIONS, GROUPS, HOME, destinationAt, type Destination } from "../navigation";
import { SidebarFooter } from "./SidebarFooter";
import type { Sidebar as SidebarState } from "./useSidebar";

const WIDTH = "16.25rem";
const RAIL = "3.5rem";

const useStyles = makeStyles({
  // Pinned to the viewport: the page scrolls, the way out of it does not.
  drawer: { width: WIDTH, position: "sticky", top: 0, height: "100vh", flexShrink: 0 },
  overlay: { width: WIDTH },
  label: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.spacingHorizontalS, width: "100%" },
  logo: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: tokens.fontWeightBold,
    fontSize: tokens.fontSizeBase300,
  },
  rail: {
    position: "sticky",
    top: 0,
    height: "100vh",
    width: RAIL,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: tokens.spacingVerticalXS,
    paddingBlock: tokens.spacingVerticalM,
    boxSizing: "border-box",
    backgroundColor: tokens.colorNeutralBackground4,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
  },
  railHome: { marginBlock: tokens.spacingVerticalS, display: "inline-flex", borderRadius: tokens.borderRadiusMedium },
  railItem: { position: "relative" },
  // The rail's selection marker matches the expanded Nav's: a short brand bar
  // at the leading edge, plus the filled icon -- never color alone.
  railSelected: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    "::before": {
      content: '""',
      position: "absolute",
      left: "-8px",
      top: "8px",
      bottom: "8px",
      width: "3px",
      borderRadius: tokens.borderRadiusCircular,
      backgroundColor: tokens.colorCompoundBrandStroke,
    },
  },
  railBadge: { position: "absolute", top: "-2px", right: "-4px", pointerEvents: "none" },
  grow: { flexGrow: 1 },
});

export function Sidebar({ sidebar }: { sidebar: SidebarState }) {
  if (sidebar.mode === "rail") return <Rail sidebar={sidebar} />;
  return <Drawer sidebar={sidebar} />;
}

function Logo() {
  const styles = useStyles();
  return (
    <span className={styles.logo} aria-hidden>
      Q
    </span>
  );
}

// The body scrolls on its own, and starts at the top: a destination far down the
// list would sit behind the footer, or below the fold, with nothing to say so.
// When the route changes, the selected item is brought into view. Centred, never
// "nearest": the footer overlays the bottom of the scrolling body, so an item
// aligned to its edge would still sit half behind the footer.
// The body also shrinks once the footer's version line arrives, so the scroll is
// repeated whenever it resizes -- until the person scrolls or clicks in it.
function useActiveInView(body: RefObject<HTMLDivElement | null>, pathname: string) {
  useEffect(() => {
    const el = body.current;
    if (!el) return undefined;
    let touched = false;
    const bring = () => { if (!touched) el.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "center" }); };
    const stop = () => { touched = true; };
    const events = ["wheel", "pointerdown", "keydown"] as const;
    events.forEach((name) => el.addEventListener(name, stop, { passive: true }));
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(bring);
    observer?.observe(el);
    bring();
    return () => {
      observer?.disconnect();
      events.forEach((name) => el.removeEventListener(name, stop));
    };
  }, [body, pathname]);
}

function Drawer({ sidebar }: { sidebar: SidebarState }) {
  const styles = useStyles();
  const follow = useFollow();
  const { pathname } = useLocation();
  const overlay = sidebar.mode === "overlay";
  const body = useRef<HTMLDivElement>(null);
  useActiveInView(body, pathname);
  return (
    <NavDrawer
      open={sidebar.open}
      type={overlay ? "overlay" : "inline"}
      selectedValue={destinationAt(pathname)?.id ?? ""}
      onOpenChange={(_, d) => !d.open && sidebar.close()}
      className={overlay ? styles.overlay : styles.drawer}
      aria-label="Main navigation"
    >
      <NavDrawerHeader>
        <Tooltip content={overlay ? "Close navigation" : "Collapse navigation"} relationship="label">
          <Hamburger onClick={sidebar.toggle} aria-expanded />
        </Tooltip>
      </NavDrawerHeader>
      <NavDrawerBody ref={body}>
        <AppItem icon={<Logo />} as="a" href={HOME} onClick={follow(HOME)}>
          Orbit Control
        </AppItem>
        {GROUPS.flatMap((group) => [
          <NavSectionHeader key={`group:${group}`}>{group}</NavSectionHeader>,
          ...DESTINATIONS.filter((d) => d.group === group).map((d) => (
            <NavItem key={d.id} value={d.id} href={d.path} icon={<d.icon />} onClick={follow(d.path)}>
              <span className={styles.label}>
                {d.label}
                {d.badge && <d.badge />}
              </span>
            </NavItem>
          )),
        ])}
      </NavDrawerBody>
      <NavDrawerFooter>
        <SidebarFooter compact={false} />
      </NavDrawerFooter>
    </NavDrawer>
  );
}

function Rail({ sidebar }: { sidebar: SidebarState }) {
  const styles = useStyles();
  const follow = useFollow();
  const here = destinationAt(useLocation().pathname);
  return (
    <nav className={styles.rail} aria-label="Main navigation">
      <Tooltip content="Expand navigation" relationship="label" positioning="after">
        <Hamburger onClick={sidebar.toggle} aria-expanded={false} />
      </Tooltip>
      <Tooltip content="Orbit Control" relationship="label" positioning="after">
        <a className={styles.railHome} href={HOME} onClick={follow(HOME)}>
          <Logo />
        </a>
      </Tooltip>
      {DESTINATIONS.map((d) => (
        <RailItem key={d.id} destination={d} selected={d === here} onClick={follow(d.path)} />
      ))}
      <span className={styles.grow} />
      <SidebarFooter compact />
    </nav>
  );
}

function RailItem({ destination: d, selected, onClick }: { destination: Destination; selected: boolean; onClick: ReturnType<ReturnType<typeof useFollow>> }) {
  const styles = useStyles();
  return (
    <span className={styles.railItem}>
      <Tooltip content={d.label} relationship="label" positioning="after">
        <Button
          as="a"
          href={d.path}
          onClick={onClick}
          appearance="subtle"
          size="large"
          icon={<d.icon filled={selected} />}
          aria-current={selected ? "page" : undefined}
          className={mergeClasses(selected && styles.railSelected)}
        />
      </Tooltip>
      {d.badge && (
        <span className={styles.railBadge}>
          <d.badge />
        </span>
      )}
    </span>
  );
}
