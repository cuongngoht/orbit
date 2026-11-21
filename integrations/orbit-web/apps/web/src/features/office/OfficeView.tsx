// THE VIRTUAL OFFICE of the account: its overview (departments and AI employees), the work, what needs the owner and the
// schedules -- and one employee or one mission, each its own screen with a way back. Every place is in the URL
// (`#/office/...`), so a reload or a link comes back to it. Nothing here needs an AI connection to open: hiring and
// work say where to connect one.
import { Button, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Alert16Regular, ArrowLeft20Regular, Board16Regular, BuildingMultiple20Regular, CalendarLtr16Regular, Navigation20Regular, TaskListSquareLtr16Regular } from "@fluentui/react-icons";
import type { AuthAccount } from "@orbit-web/contracts";
import type { ReactElement } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { EmployeePage } from "./EmployeePage";
import { InboxPage } from "./InboxPage";
import { MissionPage } from "./MissionPage";
import { OverviewPage } from "./OverviewPage";
import { SchedulePage } from "./SchedulePage";
import { WorkPage } from "./WorkPage";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const NAV: { page: OfficePage; label: string; icon: ReactElement }[] = [
  { page: "overview", label: "Overview", icon: <Board16Regular /> },
  { page: "work", label: "Work", icon: <TaskListSquareLtr16Regular /> },
  { page: "inbox", label: "Needs me", icon: <Alert16Regular /> },
  { page: "schedule", label: "Schedule", icon: <CalendarLtr16Regular /> },
];

const TITLES: Record<OfficePage, string> = { overview: "Overview", work: "Work", inbox: "Needs me", schedule: "Schedule", employee: "Employee", mission: "Mission" };

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, backgroundColor: tokens.colorNeutralBackground1 },
  top: {
    backgroundColor: "var(--orbit-header-bg)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "max(10px, env(safe-area-inset-top))",
    paddingBottom: "10px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": { paddingLeft: "8px", paddingRight: "8px" },
    flexShrink: 0,
  },
  topInner: { maxWidth: "1120px", width: "100%", marginLeft: "auto", marginRight: "auto", display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  emblem: { width: "34px", height: "34px", borderRadius: "10px", backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  subnavBar: {
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": { paddingLeft: "8px", paddingRight: "8px" },
    flexShrink: 0,
  },
  subnav: { maxWidth: "1120px", width: "100%", marginLeft: "auto", marginRight: "auto", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 },
  tab: {
    flexShrink: 0,
    minHeight: "32px",
    borderRadius: "9999px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
  tabOn: { backgroundColor: tokens.colorSubtleBackgroundSelected, color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold },
  touch: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  content: {
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
    overflowY: "auto",
    overflowX: "hidden",
    paddingTop: "20px",
    paddingBottom: "max(32px, env(safe-area-inset-bottom))",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": { paddingTop: "12px", paddingLeft: "10px", paddingRight: "10px" },
  },
});

function Page({ page, item, tab, go, account }: { page: OfficePage; item: string | null; tab: string | null; go: Go; account: AuthAccount | null }) {
  if (page === "employee" && item !== null) return <EmployeePage key={item} id={item} tab={tab} go={go} />;
  if (page === "mission" && item !== null) return <MissionPage key={item} id={item} tab={tab} go={go} />;
  if (page === "work") return <WorkPage go={go} />;
  if (page === "inbox") return <InboxPage go={go} />;
  if (page === "schedule") return <SchedulePage go={go} account={account} />;
  return <OverviewPage go={go} account={account} />;
}

export function OfficeView({ page, item, tab, go, account, onOpenNav }: { page: OfficePage; item: string | null; tab: string | null; go: Go; account: AuthAccount | null; onOpenNav?: () => void }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const detail = page === "employee" || page === "mission";
  // A detail screen goes back to the list it belongs to.
  const back: OfficePage = page === "mission" ? "work" : "overview";
  return (
    <div className={`${s.root} orbit-touch`}>
      <header className={s.top}>
        <div className={s.topInner}>
          {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
          {detail ? (
            <Button className={s.touch} appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => go(back)}>
              Back
            </Button>
          ) : (
            !isMobile && (
              <span className={s.emblem} aria-hidden>
                <BuildingMultiple20Regular />
              </span>
            )
          )}
          <Text as="h1" weight="semibold" size={isMobile ? 400 : 500} className={s.title}>
            Office · {TITLES[page]}
          </Text>
        </div>
      </header>
      {!(detail && isMobile) && (
        <div className={s.subnavBar}>
          <nav className={mergeClasses(s.subnav)} aria-label="Office">
            {NAV.map((n) => (
              <Button key={n.page} size="small" appearance="subtle" icon={n.icon} className={mergeClasses(s.tab, n.page === page && s.tabOn)} aria-current={n.page === page ? "page" : undefined} onClick={() => go(n.page)}>
                {n.label}
              </Button>
            ))}
          </nav>
        </div>
      )}
      <div className={s.content}>
        <Page page={page} item={item} tab={tab} go={go} account={account} />
      </div>
    </div>
  );
}
