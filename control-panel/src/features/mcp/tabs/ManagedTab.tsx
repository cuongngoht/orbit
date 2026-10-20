import { Badge, Button, Caption1 } from "@fluentui/react-components";
import { useNavigate } from "react-router";
import { Card } from "../../../shared/components/Card";
import type { ManagedServer } from "../mcp.types";
import { originLine, StateBadge, toolsLine } from "../McpStatus";
import { managedPath, MCP_CATALOG } from "../paths";
import { Rows, ServerRow } from "./rows";

// What Orbit OWNS: kept in the machine store, independent of any host, and the
// only MCP servers the resolver may ever choose. Eligible is its own badge:
// enabled means a server may be CONSIDERED, never that it is used everywhere.
export function ManagedTab({ servers }: { servers: ManagedServer[] }) {
  const navigate = useNavigate();
  return (
    <>
      <Card title="Managed by Orbit" subtitle="Kept in the machine store: a plugin upgrade cannot remove them, and no host configuration is involved." action={<Button onClick={() => navigate(MCP_CATALOG)}>Add from the catalog</Button>}>
        <Rows empty="Orbit manages no MCP server yet. Add Microsoft Learn from the catalog, or a custom one.">
          {servers.map((s) => (
            <ServerRow key={s.key} name={s.name} href={managedPath(s.id)} line={originLine(s)} note={s.state === "ready" ? null : s.why}>
              <StateBadge state={s.state} />
              <Badge appearance="outline" color={s.eligible ? "brand" : "subtle"}>
                {s.eligible ? "Resolver eligible" : "Not eligible"}
              </Badge>
              <Caption1>{toolsLine(s)}</Caption1>
            </ServerRow>
          ))}
        </Rows>
      </Card>
    </>
  );
}

