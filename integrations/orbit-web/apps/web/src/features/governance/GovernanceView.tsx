// THE GOVERNANCE CONSOLE of the account this browser is signed in to: its policy and the overrides that narrow it, its
// departments' policies, its chats and research workspaces, what was decided, what waits for its owner, the audit
// record, findings and reports. It opens with the sign-in itself -- there is no second sign-in, no operator and no role: the person whose browser
// finished the Claude sign-in owns the account and governs it, and nobody else's. Every page reads the API, which holds
// every route to this browser's session whatever a page shows.
import { Avatar, Button, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Navigation20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import {
  ApprovalsIcon,
  AuditChainIcon,
  DecisionsIcon,
  DesksIcon,
  FindingsIcon,
  ShieldClearIcon,
  GovernanceIcon,
  IconBadge,
  OverviewIcon,
  PolicyIcon,
  ReportsIcon,
  ResearchIcon,
  RosterIcon,
  WorkspacesIcon,
  toneColor,
  type IconTone,
} from "../../components/SectionIcons";
import { GOVERNANCE_PAGES, type GovernancePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";
import { ApprovalsPage } from "./ApprovalsPage";
import { AuditPage } from "./AuditPage";
import { DecisionsPage } from "./DecisionsPage";
import { DepartmentsPage } from "./DepartmentsPage";
import { EmployeeDesksPage } from "./EmployeeDesksPage";
import { FindingsPage } from "./FindingsPage";
import { OverviewPage } from "./OverviewPage";
import { PolicyPage } from "./PolicyPage";
import { ReportsPage } from "./ReportsPage";
import { RuntimeSecurityPage } from "./RuntimeSecurityPage";
import { ResourcesPage } from "./ResourcesPage";

const TITLE_KEYS: Record<GovernancePage, MessageKey> = {
  overview: "governance.nav.overview",
  policy: "governance.nav.policy",
  departments: "governance.nav.departments",
  workspaces: "governance.nav.workspaces",
  research: "governance.nav.research",
  desks: "governance.nav.desks",
  approvals: "governance.nav.approvals",
  decisions: "governance.nav.decisions",
  audit: "governance.nav.audit",
  findings: "governance.nav.findings",
  "runtime-security": "governance.nav.runtime-security",
  reports: "governance.nav.reports",
};

const NAV_META: Record<GovernancePage, { tone: IconTone; icon: (active: boolean) => ReactElement }> = {
  overview: { tone: "brand", icon: (active) => <OverviewIcon size={16} active={active} /> },
  policy: { tone: "brand", icon: (active) => <PolicyIcon size={16} active={active} /> },
  departments: { tone: "teal", icon: (active) => <RosterIcon size={16} active={active} /> },
  workspaces: { tone: "brand", icon: (active) => <WorkspacesIcon size={16} active={active} /> },
  research: { tone: "teal", icon: (active) => <ResearchIcon size={16} active={active} /> },
  desks: { tone: "neutral", icon: (active) => <DesksIcon size={16} active={active} /> },
  approvals: { tone: "warning", icon: (active) => <ApprovalsIcon size={16} active={active} /> },
  decisions: { tone: "brand", icon: (active) => <DecisionsIcon size={16} active={active} /> },
  audit: { tone: "teal", icon: (active) => <AuditChainIcon size={16} active={active} /> },
  findings: { tone: "danger", icon: (active) => <FindingsIcon size={16} active={active} /> },
  "runtime-security": { tone: "warning", icon: (active) => <ShieldClearIcon size={16} active={active} /> },
  reports: { tone: "teal", icon: (active) => <ReportsIcon size={16} active={active} /> },
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
    maxWidth: "1160px",
    width: "100%",
    marginTop: 0,
    marginRight: "auto",
    marginBottom: 0,
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "10px",
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
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    maxWidth: "260px",
    overflow: "hidden",
    flexShrink: 0,
  },
  accountText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  subnavBar: {
    backgroundColor: "var(--orbit-header-bg)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": {
      paddingLeft: "10px",
      paddingRight: "10px",
    },
    flexShrink: 0,
  },
  subnav: {
    maxWidth: "1160px",
    width: "100%",
    marginTop: 0,
    marginRight: "auto",
    marginBottom: 0,
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: "4px",
    flexWrap: "wrap",
    paddingTop: "2px",
    paddingBottom: "2px",
    paddingRight: "16px",
    "@media (max-width: 639px)": {
      flexWrap: "nowrap",
      overflowX: "auto",
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
    ":focus-visible": { borderRadius: "9999px" },
    "&[data-fui-focus-visible]::after": { borderRadius: "9999px" },
    "@media (pointer: coarse)": { minHeight: "38px" },
  },
  tabSelected: {
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: "var(--orbit-soft-shadow)",
    ...shorthands.borderColor(tokens.colorNeutralStroke2),
    ":hover": { backgroundColor: "var(--orbit-card-bg)", color: tokens.colorNeutralForeground1 },
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
  if (page === "departments") return <DepartmentsPage item={item} go={go} />;
  if (page === "workspaces") return <ResourcesPage kind="workspace" item={item} go={go} />;
  if (page === "research") return <ResourcesPage kind="research_workspace" item={item} go={go} />;
  if (page === "desks") return <EmployeeDesksPage item={item} go={go} />;
  if (page === "decisions") return <DecisionsPage go={go} />;
  if (page === "approvals") return <ApprovalsPage item={item} />;
  if (page === "audit") return <AuditPage item={item} />;
  if (page === "findings") return <FindingsPage go={go} />;
  if (page === "runtime-security") return <RuntimeSecurityPage />;
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
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const name = account ? account.displayName || account.email : null;
  const emailSuffix = account?.displayName ? t("governance.view.accountEmailSuffix", { email: account.email }) : "";
  const navRefs = useRef<Partial<Record<GovernancePage, HTMLElement | null>>>({});
  useEffect(() => {
    navRefs.current[page]?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [page]);

  return (
    <div className={mergeClasses(s.root, "orbit-touch")}>
      <header className={s.top}>
        <div className={s.topInner}>
          {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label={t("governance.view.openNav")} onClick={onOpenNav} />}
          {!isMobile && <IconBadge icon={<GovernanceIcon size={18} active />} tone="brand" size="md" />}
          <div className={s.title}>
            <Text as="h1" weight="semibold" size={isMobile ? 400 : 500} style={{ margin: 0 }}>
              {t("governance.view.headerTitle", { page: t(TITLE_KEYS[page]) })}
            </Text>
            {name !== null && isMobile && (
              <Text size={200} className={s.muted}>
                {name}
              </Text>
            )}
          </div>
          {name !== null && !isMobile && (
            <div className={s.accountPill} title={t("governance.view.accountTooltip", { name, email: emailSuffix })}>
              <Avatar name={name} size={20} />
              <Text size={200} className={s.accountText}>
                {name}
              </Text>
            </div>
          )}
        </div>
      </header>
      <div className={s.subnavBar}>
        <nav className={mergeClasses(s.subnav, "orbit-hscroll", isMobile && "orbit-hscroll-fade")} aria-label={t("governance.view.navAria")}>
          {GOVERNANCE_PAGES.map((p) => {
            const active = p === page;
            const meta = NAV_META[p];
            return (
              <Button
                key={p}
                ref={(el) => {
                  navRefs.current[p] = el;
                }}
                size="small"
                appearance="subtle"
                icon={<span style={{ display: "inline-flex", color: active ? toneColor(meta.tone) : undefined }}>{meta.icon(active)}</span>}
                className={mergeClasses(s.tab, active && s.tabSelected)}
                aria-current={active ? "page" : undefined}
                onClick={() => go(p)}
              >
                {t(TITLE_KEYS[p])}
              </Button>
            );
          })}
        </nav>
      </div>
      <div className={s.content}>
        <Page key={page} page={page} item={item} go={go} />
      </div>
    </div>
  );
}
