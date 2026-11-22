// THE VIRTUAL OFFICE of the account: its overview (departments and AI employees), the work, what needs the owner and the
// schedules -- and one employee or one mission, each its own screen with a way back. Every place is in the URL
// (`#/office/...`), so a reload or a link comes back to it. Nothing here needs an AI connection to open: hiring and
// work say where to connect one.
import { Button, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowLeft20Regular, Navigation20Regular } from "@fluentui/react-icons";
import type { AuthAccount } from "@orbit-web/contracts";
import type { ReactElement } from "react";
import {
  IconBadge,
  InboxActionIcon,
  OfficeIcon,
  OverviewIcon,
  ScheduleIcon,
  WorkMissionIcon,
  toneColor,
  type IconTone,
} from "../../components/SectionIcons";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { EmployeePage } from "./EmployeePage";
import { InboxPage } from "./InboxPage";
import { MissionPage } from "./MissionPage";
import { OverviewPage } from "./OverviewPage";
import { SchedulePage } from "./SchedulePage";
import { WorkPage } from "./WorkPage";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const NAV: { page: OfficePage; label: string; tone: IconTone; icon: (active: boolean) => ReactElement }[] = [
  { page: "overview", label: "Overview", tone: "brand", icon: (active) => <OverviewIcon size={16} active={active} /> },
  { page: "work", label: "Work", tone: "teal", icon: (active) => <WorkMissionIcon size={16} active={active} /> },
  { page: "inbox", label: "Needs me", tone: "warning", icon: (active) => <InboxActionIcon size={16} active={active} /> },
  { page: "schedule", label: "Schedule", tone: "teal", icon: (active) => <ScheduleIcon size={16} active={active} /> },
];

const TITLES: Record<OfficePage, string> = { overview: "Overview", work: "Work", inbox: "Needs me", schedule: "Schedule", employee: "Employee", mission: "Mission" };

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0, backgroundColor: tokens.colorNeutralBackground1 },
  top: {
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "max(10px, env(safe-area-inset-top))",
    paddingBottom: "10px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": { paddingLeft: "8px", paddingRight: "8px" },
    flexShrink: 0,
  },
  topInner: { maxWidth: "1160px", width: "100%", marginLeft: "auto", marginRight: "auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", minWidth: 0 },
  left: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flexGrow: 1 },
  title: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  subnavBar: {
    backgroundColor: "var(--orbit-header-bg)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingLeft: "8px",
    paddingRight: "8px",
    flexShrink: 0,
  },
  pillTrack: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    paddingTop: "3px",
    paddingRight: "3px",
    paddingBottom: "3px",
    paddingLeft: "3px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  subnavMobile: { maxWidth: "1160px", width: "100%", marginLeft: "auto", marginRight: "auto", display: "flex", alignItems: "center", gap: "6px", overflowX: "auto", minWidth: 0 },
  tab: {
    flexShrink: 0,
    minHeight: "30px",
    borderRadius: "9999px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    "&[data-fui-focus-visible]::after": { borderRadius: "9999px" },
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
  tabOn: {
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: "var(--orbit-soft-shadow)",
  },
  tabMobileOn: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
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

function OfficeNav({ page, go, mobile }: { page: OfficePage; go: Go; mobile: boolean }) {
  const s = useStyles();
  return (
    <nav className={mobile ? mergeClasses(s.subnavMobile, "orbit-hscroll") : s.pillTrack} aria-label="Office">
      {NAV.map((n) => {
        const active = n.page === page;
        return (
          <Button
            key={n.page}
            size="small"
            appearance="subtle"
            icon={<span style={{ display: "inline-flex", color: active ? toneColor(n.tone) : undefined }}>{n.icon(active)}</span>}
            className={mergeClasses(s.tab, active && (mobile ? s.tabMobileOn : s.tabOn))}
            aria-current={active ? "page" : undefined}
            onClick={() => go(n.page)}
          >
            {n.label}
          </Button>
        );
      })}
    </nav>
  );
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
          <div className={s.left}>
            {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
            {detail ? (
              <Button className={s.touch} appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => go(back)}>
                Back
              </Button>
            ) : (
              !isMobile && <IconBadge icon={<OfficeIcon size={18} active />} tone="brand" size="md" />
            )}
            <Text as="h1" weight="semibold" size={isMobile ? 400 : 500} className={s.title}>
              Office · {TITLES[page]}
            </Text>
          </div>
          {!isMobile && <OfficeNav page={page} go={go} mobile={false} />}
        </div>
      </header>
      {isMobile && !detail && (
        <div className={s.subnavBar}>
          <OfficeNav page={page} go={go} mobile />
        </div>
      )}
      <div className={s.content}>
        <Page page={page} item={item} tab={tab} go={go} account={account} />
      </div>
    </div>
  );
}
