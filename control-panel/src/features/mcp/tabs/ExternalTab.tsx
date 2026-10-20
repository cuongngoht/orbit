import { Badge, Button, Caption1 } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { mcpApi, useMcpChange } from "../mcp.api";
import type { ExternalServer } from "../mcp.types";
import { StateBadge, toolsLine } from "../McpStatus";
import { externalPath } from "../paths";
import { Rows, ServerRow } from "./rows";

const SCOPE: Record<string, string> = { user: "User", local: "Local", project: "Project", plugin: "Plugin" };

// What a HOST has configured: observed, testable, and never chosen by Orbit's
// resolver -- however well it matches a task. Orbit writes nothing here.
export function ExternalTab({ servers, host, readOnly }: { servers: ExternalServer[]; host: string; readOnly: boolean }) {
  const refresh = useMcpChange(mcpApi.refreshExternal);
  return (
    <Card
      title={`External — observed in ${host}`}
      subtitle="Orbit reads the host's configuration and never changes it. These are never selected by Orbit's router; to use one through Orbit, add it to Orbit as a managed server."
      action={
        <Button icon={<ArrowClockwise20Regular />} disabled={readOnly || refresh.isPending} onClick={() => refresh.mutate(undefined)}>
          {refresh.isPending ? "Reading…" : "Read the host again"}
        </Button>
      }
    >
      {refresh.isError && <ErrorState error={refresh.error} title="Could not read the host" />}
      <Rows empty="The host has no MCP servers configured.">
        {servers.map((s) => (
          <ServerRow key={s.key} name={s.name} href={externalPath(s.id)} line={`${host} · ${SCOPE[s.scope ?? ""] ?? s.scope ?? "—"}${s.catalog ? ` · recognised as ${s.catalog}` : ""}`}>
            <StateBadge state="external" />
            <Badge appearance="outline" color="subtle">
              Not eligible
            </Badge>
            <Caption1>{toolsLine(s)}</Caption1>
          </ServerRow>
        ))}
      </Rows>
    </Card>
  );
}
