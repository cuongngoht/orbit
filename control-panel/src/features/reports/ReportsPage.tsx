import { Button, MessageBar, MessageBarBody, Tab, TabList, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../shared/components/PageHeader";
import { reportKeys } from "./reports.api";
import { REPORT_TABS, type ReportsTab, isReportsTab, reportTabPath } from "./reportWords";
import { ConnectionTab } from "./tabs/ConnectionTab";
import { ExtensionsTab } from "./tabs/ExtensionsTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { SectionsTab } from "./tabs/SectionsTab";
import { SettingsTab } from "./tabs/SettingsTab";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
});

// `/reports`, `/reports/settings`, … : one project's PO report -- the project
// Orbit Control was started from. The page configures and explains; a report
// itself runs from the skill or the CLI, never from a button here.
export function ReportsPage({ tab = "overview" }: { tab?: ReportsTab }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const client = useQueryClient();
  return (
    <>
      <PageHeader
        title="PO Reports"
        description="This project's report for its product owner: which source it reads, over which window, which sections it shows, and the parts that compute it — the standard ones and the ones made for this project."
        actions={
          <Button icon={<ArrowClockwise20Regular />} onClick={() => client.invalidateQueries({ queryKey: reportKeys.all })}>
            Refresh
          </Button>
        }
      />
      <div className={styles.stack}>
        <TabList selectedValue={tab} onTabSelect={(_, d) => isReportsTab(d.value) && navigate(reportTabPath(d.value))} aria-label="PO Reports">
          {REPORT_TABS.map((t) => (
            <Tab key={t.id} value={t.id}>
              {t.label}
            </Tab>
          ))}
        </TabList>
        <Tabbed tab={tab} />
        <MessageBar intent="info">
          <MessageBarBody>Run a report from the project's checkout: ask the orbit-report skill, or run node &lt;plugin&gt;/cli/project-report.mjs run. It reads the last two complete months unless you ask for another window.</MessageBarBody>
        </MessageBar>
      </div>
    </>
  );
}

function Tabbed({ tab }: { tab: ReportsTab }) {
  if (tab === "settings") return <SettingsTab />;
  if (tab === "connection") return <ConnectionTab />;
  if (tab === "sections") return <SectionsTab />;
  if (tab === "extensions") return <ExtensionsTab />;
  return <OverviewTab />;
}
