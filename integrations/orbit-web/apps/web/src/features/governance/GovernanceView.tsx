// THE GOVERNANCE CONSOLE: the company Constitution, who administers it, which agents work under it and where, what was
// decided, what waits for a person, the audit record, findings and reports. Every page reads the API; a control a
// person's roles do not allow is not shown -- and the API refuses it anyway, whatever a page shows.
import { Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Navigation20Regular, SignOut20Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
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
import { useState } from "react";

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

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  top: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingTop: "max(10px, env(safe-area-inset-top))",
    paddingBottom: "10px",
    paddingLeft: "16px",
    paddingRight: "16px",
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: tokens.colorNeutralStroke2,
    flexWrap: "wrap",
  },
  title: { flexGrow: 1, minWidth: 0 },
  body: { display: "flex", flexGrow: 1, minHeight: 0 },
  nav: {
    width: "220px",
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    paddingTop: "12px",
    paddingLeft: "8px",
    paddingRight: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: tokens.colorNeutralStroke2,
    overflowY: "auto",
  },
  navItem: { justifyContent: "flex-start", width: "100%", borderRadius: "10px", fontWeight: tokens.fontWeightRegular, transitionProperty: "background-color", transitionDuration: "140ms" },
  navSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected, fontWeight: tokens.fontWeightSemibold },
  mobileNav: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    overflowX: "auto",
    paddingBottom: "10px",
    paddingRight: "18px",
    marginBottom: "8px",
  },
  mobileNavPill: { flexShrink: 0, minHeight: "34px" },
  content: { flexGrow: 1, minWidth: 0, overflowY: "auto", paddingTop: "16px", paddingBottom: "32px", paddingLeft: "16px", paddingRight: "16px" },
  touch: { minWidth: "44px", minHeight: "44px" },
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
      {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
      <div className={s.title}>
        <Text weight="semibold" size={500}>
          Governance{session ? ` · ${TITLES[page]}` : ""}
        </Text>
        {state?.organization && (
          <Text size={200} className={s.muted} block>
            {state.organization.name} · {state.deployment === "governed" ? "governed deployment" : "single-container deployment"}
          </Text>
        )}
      </div>
      {session && (
        <>
          <Text size={200}>
            {session.operator.displayName} ({session.operator.roles.join(", ").replace(/_/g, " ") || "no role"})
          </Text>
          <Button appearance="subtle" icon={<SignOut20Regular />} onClick={signOut}>
            {!isMobile && "Sign out"}
          </Button>
        </>
      )}
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
        <MessageBar intent="error">
          <MessageBarBody>{operator.error ?? "Governance could not be read."}</MessageBarBody>
        </MessageBar>
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
      {signOutError && (
        <MessageBar intent="error">
          <MessageBarBody>{signOutError}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.body}>
        {!isMobile && (
          <nav className={s.nav} aria-label="Governance">
            {GOVERNANCE_PAGES.map((p) => (
              <Button key={p} appearance="subtle" className={mergeClasses(s.navItem, p === page && s.navSelected)} aria-current={p === page ? "page" : undefined} onClick={() => go(p)}>
                {TITLES[p]}
              </Button>
            ))}
          </nav>
        )}
        <div className={s.content}>
          {isMobile && (
            <nav className={mergeClasses(s.mobileNav, "orbit-hscroll orbit-hscroll-fade")} aria-label="Governance">
              {GOVERNANCE_PAGES.map((p) => (
                <Button
                  key={p}
                  size="small"
                  shape="circular"
                  appearance={p === page ? "primary" : "subtle"}
                  className={s.mobileNavPill}
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => go(p)}
                >
                  {TITLES[p]}
                </Button>
              ))}
            </nav>
          )}
          <Page page={page} item={item} go={go} />
        </div>
      </div>
    </div>
  );
}
