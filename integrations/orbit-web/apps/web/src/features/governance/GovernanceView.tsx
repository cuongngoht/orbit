// THE GOVERNANCE CONSOLE: the company Constitution, who administers it, which agents work under it and where, what was
// decided, what waits for a person, the audit record, findings and reports. Every page reads the API; a control a
// person's roles do not allow is not shown -- and the API refuses it anyway, whatever a page shows.
import { Avatar, Badge, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  Board16Regular,
  Bot16Regular,
  CheckmarkCircle16Regular,
  DocumentCheckmark16Regular,
  DocumentText16Regular,
  History16Regular,
  Navigation20Regular,
  People16Regular,
  Scales16Regular,
  ShieldKeyhole20Regular,
  SignOut20Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import { useState, type ReactElement, type ReactNode } from "react";
import { GOVERNANCE_PAGES, type GovernancePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { errorText, send } from "../../services/api";
import { refreshOperator, useOperator } from "../../services/operator";
import { AgentsPage } from "./AgentsPage";
import { ApprovalsPage } from "./ApprovalsPage";
import { AuditPage } from "./AuditPage";
import { ConstitutionPage } from "./ConstitutionPage";
import { DecisionsPage } from "./DecisionsPage";
import { FindingsPage } from "./FindingsPage";
import { BootstrapForm, SignInForm } from "./OperatorGate";
import { OperatorsPage } from "./OperatorsPage";
import { OverviewPage } from "./OverviewPage";
import { ReportsPage } from "./ReportsPage";

const TITLES: Record<GovernancePage, string> = {
  overview: "Overview",
  constitution: "Company Constitution",
  operators: "Users & roles",
  agents: "Agents & workspaces",
  decisions: "Policy decisions",
  approvals: "Approvals",
  audit: "Audit timeline",
  findings: "Security findings",
  reports: "Daily reports",
};

const ICONS: Record<GovernancePage, ReactElement> = {
  overview: <Board16Regular />,
  constitution: <DocumentCheckmark16Regular />,
  operators: <People16Regular />,
  agents: <Bot16Regular />,
  decisions: <Scales16Regular />,
  approvals: <CheckmarkCircle16Regular />,
  audit: <History16Regular />,
  findings: <Warning16Regular />,
  reports: <DocumentText16Regular />,
};

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
  orgLine: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", color: tokens.colorNeutralForeground3 },
  operatorPill: {
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
    maxWidth: "240px",
    overflow: "hidden",
  },
  operatorText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  signOutBtn: { borderRadius: "9999px", flexShrink: 0 },
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
  muted: { color: tokens.colorNeutralForeground3 },
});

function Page({ page, item, go }: { page: GovernancePage; item: string | null; go: (page: GovernancePage, item?: string | null) => void }): ReactNode {
  if (page === "constitution") return <ConstitutionPage item={item} go={go} />;
  if (page === "operators") return <OperatorsPage />;
  if (page === "agents") return <AgentsPage />;
  if (page === "decisions") return <DecisionsPage go={go} />;
  if (page === "approvals") return <ApprovalsPage item={item} />;
  if (page === "audit") return <AuditPage item={item} />;
  if (page === "findings") return <FindingsPage go={go} />;
  if (page === "reports") return <ReportsPage item={item} go={go} />;
  return <OverviewPage go={go} />;
}

export function GovernanceView({ page, item, go, onOpenNav }: { page: GovernancePage; item: string | null; go: (page: GovernancePage, item?: string | null) => void; onOpenNav?: () => void }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const operator = useOperator();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const state = operator.state;
  const session = state?.session ?? null;

  const signOut = () => {
    setSignOutError(null);
    void send("POST", "/api/operator/logout")
      .catch((err: unknown) => setSignOutError(errorText(err)))
      .finally(() => void refreshOperator());
  };

  const header = (
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
            Governance{session ? ` · ${TITLES[page]}` : ""}
          </Text>
          {state?.organization && (
            <div className={s.orgLine}>
              <Text size={200} className={s.muted}>
                {state.organization.name}
              </Text>
              <Badge appearance="tint" color={state.deployment === "governed" ? "brand" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                {state.deployment === "governed" ? "governed deployment" : "single-container deployment"}
              </Badge>
            </div>
          )}
        </div>
        {session && (
          <>
            {!isMobile && (
              <div className={s.operatorPill} title={`${session.operator.displayName} (${session.operator.roles.join(", ").replace(/_/g, " ") || "no role"})`}>
                <Avatar name={session.operator.displayName} size={20} />
                <Text size={200} className={s.operatorText}>
                  {session.operator.displayName} ({session.operator.roles.join(", ").replace(/_/g, " ") || "no role"})
                </Text>
              </div>
            )}
            <Button className={isMobile ? s.touch : s.signOutBtn} appearance="subtle" icon={<SignOut20Regular />} aria-label="Sign out" onClick={signOut}>
              {!isMobile && "Sign out"}
            </Button>
          </>
        )}
      </div>
    </header>
  );

  if (!operator.loaded) {
    return (
      <div className={s.root}>
        {header}
        <Spinner style={{ marginTop: 48 }} label="Reading governance…" />
      </div>
    );
  }
  if (state === null) {
    return (
      <div className={s.root}>
        {header}
        <div className={s.content}>
          <MessageBar intent="error">
            <MessageBarBody>{operator.error ?? "Governance could not be read."}</MessageBarBody>
          </MessageBar>
        </div>
      </div>
    );
  }
  if (!state.initialized || session === null) {
    return (
      <div className={s.root}>
        {header}
        <div className={s.content}>{!state.initialized ? <BootstrapForm /> : <SignInForm organization={state.organization?.name ?? null} />}</div>
      </div>
    );
  }

  return (
    <div className={s.root}>
      {header}
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
        {signOutError && (
          <MessageBar intent="error" style={{ marginBottom: 16 }}>
            <MessageBarBody>{signOutError}</MessageBarBody>
          </MessageBar>
        )}
        <Page page={page} item={item} go={go} />
      </div>
    </div>
  );
}
