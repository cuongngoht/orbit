// THE GOVERNANCE CONSOLE of the account this browser is signed in to: its policy and the overrides that narrow it, its
// chats and research workspaces, what was decided, what waits for its owner, the audit record, findings and reports.
// It opens with the sign-in itself -- there is no second sign-in, no operator and no role: the person whose browser
// finished the Claude sign-in owns the account and governs it, and nobody else's. Every page reads the API, which holds
// every route to this browser's session whatever a page shows.
import { Avatar, Button, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  Board16Regular,
  BookOpen16Regular,
  Chat16Regular,
  CheckmarkCircle16Regular,
  DocumentCheckmark16Regular,
  DocumentText16Regular,
  History16Regular,
  Desktop16Regular,
  Navigation20Regular,
  Scales16Regular,
  ShieldKeyhole20Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import type { ReactElement, ReactNode } from "react";
import { GOVERNANCE_PAGES, type GovernancePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { ApprovalsPage } from "./ApprovalsPage";
import { AuditPage } from "./AuditPage";
import { DecisionsPage } from "./DecisionsPage";
import { EmployeeDesksPage } from "./EmployeeDesksPage";
import { FindingsPage } from "./FindingsPage";
import { OverviewPage } from "./OverviewPage";
import { PolicyPage } from "./PolicyPage";
import { ReportsPage } from "./ReportsPage";
import { ResourcesPage } from "./ResourcesPage";

const TITLES: Record<GovernancePage, string> = {
  overview: "Overview",
  policy: "Policy",
  workspaces: "Workspaces",
  research: "Research",
  desks: "Employee desks",
  approvals: "Approvals",
  decisions: "Decisions",
  audit: "Audit timeline",
  findings: "Security findings",
  reports: "Daily reports",
};

const ICONS: Record<GovernancePage, ReactElement> = {
  overview: <Board16Regular />,
  policy: <DocumentCheckmark16Regular />,
  workspaces: <Chat16Regular />,
  research: <BookOpen16Regular />,
  desks: <Desktop16Regular />,
  approvals: <CheckmarkCircle16Regular />,
  decisions: <Scales16Regular />,
  audit: <History16Regular />,
  findings: <Warning16Regular />,
  reports: <DocumentText16Regular />,
};

// The account governed here, as this browser's session names it.
export interface GovernedAccount {
  displayName: string;
  email: string;
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, backgroundColor: tokens.colorNeutralBackground1 },
  top: {
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "max(10px, env(safe-area-inset-top))",
    paddingBottom: "10px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": {
      paddingLeft: "10px",
      paddingRight: "10px",
    },
    flexShrink: 0,
  },
  topInner: {
    maxWidth: "1120px",
    width: "100%",
    marginTop: 0,
    marginRight: "auto",
    marginBottom: 0,
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  emblem: {
    width: "34px",
    height: "34px",
    borderRadius: "10px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  title: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  accountPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minHeight: "30px",
    paddingTop: "2px",
    paddingRight: "10px",
    paddingBottom: "2px",
    paddingLeft: "4px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    maxWidth: "260px",
    overflow: "hidden",
    flexShrink: 0,
  },
  accountText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  subnavBar: {
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": {
      paddingLeft: "12px",
      paddingRight: "12px",
    },
    flexShrink: 0,
  },
  subnav: {
    maxWidth: "1120px",
    width: "100%",
    marginTop: 0,
    marginRight: "auto",
    marginBottom: 0,
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    "@media (max-width: 639px)": {
      flexWrap: "nowrap",
      overflowX: "auto",
      paddingRight: "20px",
    },
  },
  tab: {
    flexShrink: 0,
    minHeight: "32px",
    paddingLeft: "10px",
    paddingRight: "10px",
    borderRadius: "9999px",
    ...shorthands.border("1px", "solid", "transparent"),
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover, color: tokens.colorNeutralForeground1 },
    "@media (pointer: coarse)": { minHeight: "38px" },
  },
  tabSelected: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ...shorthands.borderColor(tokens.colorNeutralStroke1),
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundSelected, color: tokens.colorNeutralForeground1 },
  },
  content: {
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
    overflowY: "auto",
    paddingTop: "20px",
    paddingBottom: "max(32px, env(safe-area-inset-bottom))",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": {
      paddingTop: "14px",
      paddingLeft: "12px",
      paddingRight: "12px",
    },
  },
  touch: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

function Page({ page, item, go }: { page: GovernancePage; item: string | null; go: (page: GovernancePage, item?: string | null) => void }): ReactNode {
  if (page === "policy") return <PolicyPage item={item} go={go} />;
  if (page === "workspaces") return <ResourcesPage kind="workspace" item={item} go={go} />;
  if (page === "research") return <ResourcesPage kind="research_workspace" item={item} go={go} />;
  if (page === "desks") return <EmployeeDesksPage />;
  if (page === "decisions") return <DecisionsPage go={go} />;
  if (page === "approvals") return <ApprovalsPage item={item} />;
  if (page === "audit") return <AuditPage item={item} />;
  if (page === "findings") return <FindingsPage go={go} />;
  if (page === "reports") return <ReportsPage item={item} go={go} />;
  return <OverviewPage go={go} />;
}

export function GovernanceView({
  page,
  item,
  go,
  account = null,
  onOpenNav,
}: {
  page: GovernancePage;
  item: string | null;
  go: (page: GovernancePage, item?: string | null) => void;
  account?: GovernedAccount | null;
  onOpenNav?: () => void;
}) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const name = account ? account.displayName || account.email : null;

  return (
    <div className={s.root}>
      <header className={s.top}>
        <div className={s.topInner}>
          {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
          {!isMobile && (
            <span className={s.emblem} aria-hidden>
              <ShieldKeyhole20Regular />
            </span>
          )}
          <div className={s.title}>
            <Text weight="semibold" size={isMobile ? 400 : 500}>
              Governance · {TITLES[page]}
            </Text>
            {name !== null && isMobile && (
              <Text size={200} className={s.muted}>
                {name}
              </Text>
            )}
          </div>
          {name !== null && !isMobile && (
            <div className={s.accountPill} title={`The account you govern: ${name}${account?.displayName ? ` (${account.email})` : ""}`}>
              <Avatar name={name} size={20} />
              <Text size={200} className={s.accountText}>
                {name}
              </Text>
            </div>
          )}
        </div>
      </header>
      <div className={s.subnavBar}>
        <nav className={mergeClasses(s.subnav, isMobile && "orbit-hscroll orbit-hscroll-fade")} aria-label="Governance">
          {GOVERNANCE_PAGES.map((p) => (
            <Button
              key={p}
              size="small"
              appearance="subtle"
              icon={ICONS[p]}
              className={mergeClasses(s.tab, p === page && s.tabSelected)}
              aria-current={p === page ? "page" : undefined}
              onClick={() => go(p)}
            >
              {TITLES[p]}
            </Button>
          ))}
        </nav>
      </div>
      <div className={s.content}>
        <Page key={page} page={page} item={item} go={go} />
      </div>
    </div>
  );
}
