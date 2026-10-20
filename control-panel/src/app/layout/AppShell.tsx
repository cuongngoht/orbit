import { useEffect, useRef } from "react";
import { Hamburger, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { AccountChip } from "../../features/account/AccountChip";
import { UnsavedChangesGuard } from "../../shared/navigation/UnsavedChanges";
import { destinationAt } from "../navigation";
import { Sidebar } from "./Sidebar";
import { useSidebar } from "./useSidebar";

const useStyles = makeStyles({
  shell: { display: "flex", alignItems: "flex-start", minHeight: "100vh", backgroundColor: tokens.colorNeutralBackground2 },
  column: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: "100vh" },
  main: {
    flexGrow: 1,
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "90rem",
    padding: `${tokens.spacingVerticalXXL} clamp(1rem, 3vw, 2.5rem)`,
    ":focus": { outline: "none" },
  },
  topBar: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    minHeight: "48px",
    boxSizing: "border-box",
  },
  grow: { flexGrow: 1 },
  skip: {
    position: "absolute",
    left: tokens.spacingHorizontalS,
    top: "-3rem",
    zIndex: 2,
    padding: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorBrandForeground1,
    borderRadius: tokens.borderRadiusMedium,
    ":focus": { top: tokens.spacingVerticalS },
  },
});

export function AppShell() {
  const styles = useStyles();
  const sidebar = useSidebar();
  useFocusOnNavigate();
  return (
    <UnsavedChangesGuard>
      <a className={styles.skip} href="#main" onClick={skipToContent}>
        Skip to content
      </a>
      <div className={styles.shell}>
        <Sidebar sidebar={sidebar} />
        <div className={styles.column}>
          <TopBar overlay={sidebar.mode === "overlay"} onMenu={sidebar.toggle} />
          <main id="main" tabIndex={-1} className={styles.main}>
            <Outlet />
          </main>
        </div>
      </div>
    </UnsavedChangesGuard>
  );
}

// Above every page: who is signed in to Claude on this machine, always; and --
// when the sidebar is an overlay on a narrow window -- the way to open it and
// the name of the page you are on.
function TopBar({ overlay, onMenu }: { overlay: boolean; onMenu: () => void }) {
  const styles = useStyles();
  const here = destinationAt(useLocation().pathname);
  return (
    <header className={styles.topBar} aria-label="Top bar">
      {overlay && <Hamburger onClick={onMenu} aria-label="Open navigation" />}
      {overlay && <Text weight="semibold">{here?.label ?? "Orbit Control"}</Text>}
      <span className={styles.grow} />
      <AccountChip />
    </header>
  );
}

function skipToContent(event: React.MouseEvent) {
  event.preventDefault();
  document.getElementById("main")?.focus();
}

// A single-page app never reloads, so a screen reader is never told the page
// changed. Moving focus to <main> on every navigation (not the first load)
// announces it, and starts keyboard users at the top of the new page.
//
// A REPLACE is not a page the person chose -- `/` redirecting to the home page
// is one -- so it leaves focus where it is.
function useFocusOnNavigate() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  const first = useRef(true);
  useEffect(() => {
    if (first.current || type === "REPLACE") {
      first.current = false;
      return;
    }
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname, type]);
}
