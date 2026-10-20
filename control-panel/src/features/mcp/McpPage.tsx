import { Button, Tab, TabList, makeStyles, tokens } from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useNavigate } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { CatalogTab } from "./tabs/CatalogTab";
import { ExternalTab } from "./tabs/ExternalTab";
import { ManagedTab } from "./tabs/ManagedTab";
import { PoliciesTab } from "./tabs/PoliciesTab";
import { useMcpOverview } from "./mcp.api";
import type { McpOverview } from "./mcp.types";
import { MCP_CATALOG, MCP_EXTERNAL, MCP_NEW, MCP_PATH, MCP_POLICIES } from "./paths";

export type McpTab = "managed" | "external" | "catalog" | "policies";

const TABS: readonly { id: McpTab; label: string }[] = [
  { id: "managed", label: "Managed" },
  { id: "external", label: "External" },
  { id: "catalog", label: "Catalog" },
  { id: "policies", label: "Policies" },
];

const PATH: Record<McpTab, string> = { managed: MCP_PATH, external: MCP_EXTERNAL, catalog: MCP_CATALOG, policies: MCP_POLICIES };

const isTab = (value: unknown): value is McpTab => TABS.some((t) => t.id === value);

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
});

// `/mcp`, `/mcp/external`, `/mcp/catalog`, `/mcp/policies`: one page, four
// tabs, and a server is in exactly one of the first three. What Orbit MANAGES
// lives in the machine store and is what the resolver may choose; what the
// HOST has is observed and never chosen; the catalog is only what is known.
export function McpPage({ tab = "managed" }: { tab?: McpTab }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const overview = useMcpOverview();
  const readOnly = !mutationToken();
  return (
    <>
      <PageHeader
        title="MCP"
        description="The MCP servers Orbit manages — kept in the machine store, independent of any host — the ones a host has configured, which Orbit only observes, and Orbit's catalog. Secrets are named, never kept."
        actions={
          <>
            <Button icon={<ArrowClockwise20Regular />} onClick={() => overview.refetch()} disabled={overview.isFetching}>
              {overview.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
            <Button appearance="primary" icon={<Add20Regular />} disabled={readOnly} onClick={() => navigate(MCP_NEW)}>
              Add custom
            </Button>
          </>
        }
      />
      <div className={styles.stack}>
        <TabList selectedValue={tab} onTabSelect={(_, d) => isTab(d.value) && navigate(PATH[d.value])} aria-label="MCP">
          {TABS.map((t) => (
            <Tab key={t.id} value={t.id}>
              {t.label}
              {counts(overview.data, t.id)}
            </Tab>
          ))}
        </TabList>
        {overview.isPending && <LoadingState label="Loading MCP servers…" />}
        {overview.isError && <ErrorState error={overview.error} title="Could not list MCP servers" onRetry={() => overview.refetch()} />}
        {overview.data && <Tabbed tab={tab} overview={overview.data} readOnly={readOnly} />}
      </div>
    </>
  );
}

function counts(data: McpOverview | undefined, tab: McpTab) {
  if (!data || (tab !== "managed" && tab !== "external")) return null;
  return ` (${data[tab].length})`;
}

function Tabbed({ tab, overview, readOnly }: { tab: McpTab; overview: McpOverview; readOnly: boolean }) {
  if (tab === "external") return <ExternalTab servers={overview.external} host={overview.host} readOnly={readOnly} />;
  if (tab === "catalog") return <CatalogTab readOnly={readOnly} />;
  if (tab === "policies") return <PoliciesTab readOnly={readOnly} />;
  return <ManagedTab servers={overview.managed} />;
}

