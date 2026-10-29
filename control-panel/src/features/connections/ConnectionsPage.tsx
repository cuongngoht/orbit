import { useState } from "react";
import { useNavigate } from "react-router";
import { Badge, Button, Caption1, Dropdown, Field, Input, Link, MessageBar, MessageBarBody, Option, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Add20Regular } from "@fluentui/react-icons";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatRelative } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { connectionsApi, useConnectionChange, useConnections } from "./connections.api";
import type { Connection, Provider } from "./connections.types";
import { BACKEND_LABEL, CONNECTION_ID, authLine, connectionPath } from "./connectionWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalL, flexWrap: "wrap", paddingBlock: tokens.spacingVerticalS, borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`, ":first-child": { borderTop: "none" } },
  who: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: "14rem" },
  muted: { color: tokens.colorNeutralForeground3 },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "end" },
});

// Every connection on this machine: which source, where, and how it gets in -- a sign-in, or where its
// credential comes from. Shared by every project; a project's report picks one.
export function ConnectionsPage() {
  const styles = useStyles();
  const view = useConnections();
  const [adding, setAdding] = useState(false);
  const readOnly = !mutationToken();
  return (
    <>
      <PageHeader
        title="Connections"
        description="The sources project reports read, and how each is let in: a sign-in Orbit keeps a session for, or a credential. A credential you enter goes to this machine's OS secret store and is never shown again; Orbit keeps only a reference."
        actions={
          <Button appearance="primary" icon={<Add20Regular />} disabled={readOnly} onClick={() => setAdding(true)}>
            New connection
          </Button>
        }
      />
      <div className={styles.stack}>
        {view.isPending && <LoadingState label="Loading connections…" />}
        {view.isError && <ErrorState error={view.error} title="Could not list connections" onRetry={() => view.refetch()} />}
        {view.data && !view.data.backend && (
          <MessageBar intent="info">
            <MessageBarBody>This machine offers no OS secret store to Orbit, so a credential is named as an environment variable you set yourself. Nothing is ever kept in a file instead.</MessageBarBody>
          </MessageBar>
        )}
        {view.data && adding && <NewConnectionCard providers={view.data.providers} onDone={() => setAdding(false)} />}
        {view.data && (
          <Card title="On this machine" subtitle={view.data.backend ? `Credentials: ${BACKEND_LABEL[view.data.backend] ?? view.data.backend}` : "Credentials: environment variables"}>
            <Rows connections={view.data.connections} providers={view.data.providers} />
          </Card>
        )}
      </div>
    </>
  );
}

function Rows({ connections, providers }: { connections: Connection[]; providers: Provider[] }) {
  const styles = useStyles();
  const follow = useFollow();
  if (!connections.length) return <Text className={styles.muted}>No connection yet. Create one for the GitHub owner or Azure DevOps organization a report reads.</Text>;
  return (
    <ul className={styles.rows}>
      {connections.map((c) => (
        <li key={c.id} className={styles.row}>
          <div className={styles.who}>
            <Link href={connectionPath(c.id)} onClick={follow(connectionPath(c.id))}>
              <Text weight="semibold">{c.label || c.id}</Text>
            </Link>
            <Caption1 className={styles.muted}>
              {providers.find((p) => p.id === c.provider)?.label ?? c.provider} · {c.organization} · {c.host}
            </Caption1>
          </div>
          <Caption1>{authLine(c, providers.find((p) => p.id === c.provider))}</Caption1>
          <TestBadge connection={c} />
          <Link href={connectionPath(c.id)} onClick={follow(connectionPath(c.id))} aria-label={`Open ${c.id}`}>
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function TestBadge({ connection }: { connection: Connection }) {
  if (!connection.lastTest) return <Badge appearance="outline">Not tested</Badge>;
  return (
    <Badge appearance="tint" color={connection.lastTest.ok ? "success" : "danger"}>
      {`${connection.lastTest.ok ? "Test passed" : "Test failed"} ${formatRelative(connection.lastTest.at)}`}
    </Badge>
  );
}

// The fields a connection needs are the PROVIDER's to say.
function NewConnectionCard({ providers, onDone }: { providers: Provider[]; onDone: () => void }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const [provider, setProvider] = useState(providers[0]?.id ?? "");
  const [id, setId] = useState("");
  const [organization, setOrganization] = useState("");
  const [host, setHost] = useState("");
  const create = useConnectionChange(connectionsApi.create);
  const chosen = providers.find((p) => p.id === provider);
  const hostField = chosen?.connection.fields.find((f) => f.name === "host");
  const orgField = chosen?.connection.fields.find((f) => f.name === "organization");
  const idOk = CONNECTION_ID.test(id);
  const submit = () => create.mutate({ id, provider, organization: organization.trim(), ...(host.trim() ? { host: host.trim() } : {}) }, { onSuccess: (made) => navigate(connectionPath(made.id)) });
  return (
    <Card title="New connection" subtitle="One account's access to one organization. How it gets in -- a sign-in or a credential -- is chosen on the next page.">
      <div className={styles.form}>
        <Field label="Source">
          <Dropdown value={chosen?.label ?? ""} selectedOptions={[provider]} onOptionSelect={(_, d) => setProvider(d.optionValue ?? provider)}>
            {providers.map((p) => (
              <Option key={p.id} value={p.id}>
                {p.label}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Name" hint="lower-case, e.g. github-acme" validationMessage={id && !idOk ? "2 to 48 lower-case letters, digits and dashes" : undefined}>
          <Input value={id} onChange={(_, d) => setId(d.value)} />
        </Field>
        <Field label={orgField?.label ?? "Organization"} hint={orgField?.doc} required>
          <Input value={organization} onChange={(_, d) => setOrganization(d.value)} />
        </Field>
        <Field label={hostField?.label ?? "Host"} hint={hostField?.doc}>
          <Input value={host} placeholder={typeof hostField?.default === "string" ? hostField.default : ""} onChange={(_, d) => setHost(d.value)} />
        </Field>
      </div>
      <div>
        <Button appearance="primary" disabled={!idOk || !organization.trim() || create.isPending} onClick={submit}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>{" "}
        <Button onClick={onDone}>Cancel</Button>
      </div>
      {create.isError && <ErrorState error={create.error} title="The connection was not created" />}
    </Card>
  );
}
