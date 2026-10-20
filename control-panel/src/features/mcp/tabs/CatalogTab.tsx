import { Badge, Button, Caption1, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { mcpApi, useMcpCatalog, useMcpChange } from "../mcp.api";
import { Rows, ServerRow, useRowStyles } from "./rows";

// Orbit's catalog: KNOWN, and nothing more. "Add to Orbit" creates a managed
// resource in the machine store -- it never writes a host's configuration --
// and an HTTP server needs nothing installed to be ready.
export function CatalogTab({ readOnly }: { readOnly: boolean }) {
  const styles = useRowStyles();
  const catalog = useMcpCatalog();
  const add = useMcpChange(mcpApi.addCatalog);
  return (
    <Card title="Catalog" subtitle="The MCP servers this plugin knows. Being listed here installs, enables or configures nothing.">
      {catalog.isPending && <LoadingState label="Loading the catalog…" />}
      {catalog.isError && <ErrorState error={catalog.error} title="Could not read the catalog" />}
      {add.isError && <ErrorState error={add.error} title="Not added" />}
      {add.isSuccess && (
        <MessageBar intent="success">
          <MessageBarBody>Added {add.data.name} to Orbit. It is managed in the machine store; test it to see it connect.</MessageBarBody>
        </MessageBar>
      )}
      <Rows empty="The catalog is empty.">
        {(catalog.data ?? []).map((e) => (
          <ServerRow key={e.id} name={e.name} line={e.description} note={e.observedInHost ? "The host also has one it recognises as this — that copy stays external." : null}>
            <span className={styles.chips}>
              {e.recommended && <Badge appearance="tint" color="brand">Recommended</Badge>}
              <Badge appearance="outline">{e.install.strategy === "remote-http" ? "Remote HTTP — nothing to install" : e.install.strategy}</Badge>
            </span>
            <Caption1 className={styles.muted}>Provides {e.provides.join(", ") || "nothing declared"}</Caption1>
            {e.added ? (
              <Badge appearance="tint" color="success">In Orbit</Badge>
            ) : (
              <Button appearance="primary" disabled={readOnly || !e.addable || add.isPending} onClick={() => add.mutate(e.id)} aria-label={`Add ${e.name} to Orbit`}>
                {add.isPending && add.variables === e.id ? "Adding…" : e.addable ? "Add to Orbit" : "Recognition only"}
              </Button>
            )}
          </ServerRow>
        ))}
      </Rows>
    </Card>
  );
}
