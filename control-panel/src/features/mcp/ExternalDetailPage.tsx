import { Badge, Button, Caption1, MessageBar, MessageBarBody, MessageBarTitle, Text } from "@fluentui/react-components";
import { Add20Regular, PlugConnected20Regular } from "@fluentui/react-icons";
import { useNavigate, useParams } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime, formatRelative } from "../../shared/format";
import { mcpApi, useExternal, useMcpChange } from "./mcp.api";
import type { ExternalServer, SecretName } from "./mcp.types";
import { CheckResult } from "./ManagedServerForm";
import { Facts, useDetailStyles, Words } from "./McpDetailPage";
import { connectionLine, StateBadge } from "./McpStatus";
import { fromExternalPath } from "./paths";

// `/mcp/external/:id`: a server a HOST has configured. Orbit observes it and
// may test it as the host configured it; it is never selected by Orbit's
// resolver, and nothing here writes to the host. To use it through Orbit, add a
// managed server of its own -- a different resource, whatever the name.
export function ExternalDetailPage() {
  const { id = "" } = useParams();
  const server = useExternal(id);
  if (server.isPending) return <LoadingState label="Loading the server…" />;
  if (server.isError) return <ErrorState error={server.error} title="Could not load the server" onRetry={() => server.refetch()} />;
  return <Detail server={server.data} />;
}

function Detail({ server }: { server: ExternalServer }) {
  const styles = useDetailStyles();
  const navigate = useNavigate();
  const readOnly = !mutationToken();
  const test = useMcpChange(mcpApi.testExternal);
  return (
    <>
      <PageHeader
        title={server.name}
        description={server.description || undefined}
        badges={<StateBadge state="external" />}
        actions={
          <>
            <Button icon={<PlugConnected20Regular />} disabled={readOnly || test.isPending} onClick={() => test.mutate(server.id)}>
              {test.isPending ? "Testing…" : "Test Connection"}
            </Button>
            <Button appearance="primary" icon={<Add20Regular />} disabled={readOnly} onClick={() => navigate(fromExternalPath(server.id))}>
              Add to Orbit
            </Button>
          </>
        }
      />
      <div className={styles.stack}>
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>Observe only</MessageBarTitle>
            {server.host ?? "The host"} owns this configuration. Orbit reads it and never changes it, and Orbit's router never selects it. Adding it to Orbit creates a separate, Orbit-managed server — its secrets are then read from the environment, never copied from the host.
          </MessageBarBody>
        </MessageBar>
        {test.data && <CheckResult check={test.data.check} />}
        {test.isError && <ErrorState error={test.error} title="The test could not run" />}
      </div>
      <div className={styles.grid}>
        <Card title="Server">
          <Facts rows={factsOf(server)} />
        </Card>
        <Card title={server.transport === "stdio" ? "Environment" : "Headers"} subtitle="Names only. The host keeps the values; they never reach this page.">
          <Names names={(server.transport === "stdio" ? server.env : server.headers) ?? []} />
        </Card>
        <Card title="Provides" subtitle={server.catalog ? `Recognised as ${server.catalog} in Orbit's catalog.` : "Not recognised by Orbit's catalog."}>
          <Words words={server.provides} empty="Nothing known." />
        </Card>
      </div>
    </>
  );
}

const SCOPE: Record<string, string> = { user: "User", local: "Local", project: "Project", plugin: "Plugin" };

const factsOf = (s: ExternalServer): [string, string][] => [
  ["Ownership", `External / ${s.host ?? "host"}`],
  ["Observed", "Yes"],
  ["Orbit Managed", "No"],
  ["Resolver eligible", "No"],
  ["Status", "Observe only"],
  ["Scope", SCOPE[s.scope ?? ""] ?? s.scope ?? "—"],
  ["In the host", s.hostEnabled === false ? "Disabled there" : "Enabled there"],
  [s.transport === "stdio" ? "Command" : "URL", s.transport === "stdio" ? [s.command, ...(s.args ?? [])].filter(Boolean).join(" ") : s.url ?? "—"],
  ["Connection", connectionLine(s)],
  ["Last checked", s.checkedAt ? `${formatDateTime(s.checkedAt)} (${formatRelative(s.checkedAt)})` : "Never"],
];

function Names({ names }: { names: SecretName[] }) {
  const styles = useDetailStyles();
  if (!names.length) return <Text className={styles.muted}>None.</Text>;
  return (
    <ul className={styles.list}>
      {names.map((n) => (
        <li key={n.name}>
          <Text weight="semibold">{n.name}</Text>{" "}
          <Badge appearance="tint" color={n.configured ? "success" : "subtle"}>
            {n.configured ? "Configured" : "Empty"}
          </Badge>
          <Caption1 className={styles.muted}> in the host</Caption1>
        </li>
      ))}
    </ul>
  );
}
