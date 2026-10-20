import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Button, Caption1, Field, Input, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Delete20Regular, PlugConnected20Regular } from "@fluentui/react-icons";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { useFollow } from "../../shared/navigation/useFollow";
import { connectionsApi, useConnection, useConnectionChange, useConnections, useSetCredential } from "./connections.api";
import type { Connection, Provider } from "./connections.types";
import { BACKEND_LABEL, CONNECTIONS_PATH, credentialWords, docLabel, newerTest } from "./connectionWords";
import { Checks } from "./ConnectionChecks";
import { TestBadge } from "./ConnectionsPage";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "end" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "center" },
});

export function ConnectionDetailPage() {
  const { id = "" } = useParams();
  const connection = useConnection(id);
  const view = useConnections();
  const follow = useFollow();
  const styles = useStyles();
  const provider = view.data?.providers.find((p) => p.id === connection.data?.provider);
  return (
    <>
      <PageHeader title={connection.data?.label || id} context={<Link href={CONNECTIONS_PATH} onClick={follow(CONNECTIONS_PATH)}>Connections</Link>} description={provider ? `${provider.label} · ${connection.data?.organization ?? ""}` : undefined} badges={connection.data && <TestBadge connection={connection.data} />} />
      <div className={styles.stack}>
        {connection.isPending && <LoadingState label="Loading the connection…" />}
        {connection.isError && <ErrorState error={connection.error} title="Could not open this connection" />}
        {connection.data && view.data && (
          <>
            <WhereCard connection={connection.data} provider={provider} />
            <CredentialCard connection={connection.data} provider={provider} backend={view.data.backend} />
            <TestCard connection={connection.data} />
            <DeleteCard connection={connection.data} />
          </>
        )}
      </div>
    </>
  );
}

function WhereCard({ connection, provider }: { connection: Connection; provider: Provider | undefined }) {
  const styles = useStyles();
  const [label, setLabel] = useState(connection.label ?? "");
  const [organization, setOrganization] = useState(connection.organization ?? "");
  const [host, setHost] = useState(connection.host ?? "");
  const save = useConnectionChange(() => connectionsApi.update(connection.id, { label, organization, host }));
  const field = (name: string) => provider?.connection.fields.find((f) => f.name === name);
  return (
    <Card title="Where" subtitle="Changing the organization or host forgets the last test: it proved nothing about the new place.">
      <div className={styles.form}>
        <Field label="Label">
          <Input value={label} onChange={(_, d) => setLabel(d.value)} />
        </Field>
        <Field label={field("organization")?.label ?? "Organization"} hint={field("organization")?.doc}>
          <Input value={organization} onChange={(_, d) => setOrganization(d.value)} />
        </Field>
        <Field label={field("host")?.label ?? "Host"} hint={field("host")?.doc}>
          <Input value={host} onChange={(_, d) => setHost(d.value)} />
        </Field>
      </div>
      <div className={styles.actions}>
        <Button disabled={!mutationToken() || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isSuccess && <Caption1>Saved.</Caption1>}
      </div>
      {save.isError && <ErrorState error={save.error} title="Not saved" />}
    </Card>
  );
}

// The value is held in this component only until it is sent, then cleared --
// it is never put in the query cache, and it is never shown again.
function CredentialCard({ connection, provider, backend }: { connection: Connection; provider: Provider | undefined; backend: string | null }) {
  const styles = useStyles();
  const [value, setValue] = useState("");
  const [env, setEnv] = useState(connection.credential.from === "env" ? connection.credential.name ?? "" : "");
  const [confirming, setConfirming] = useState(false);
  const set = useSetCredential(connection.id);
  const clear = useConnectionChange(() => connectionsApi.clearCredential(connection.id));
  const readOnly = !mutationToken();
  const store = () => {
    const sent = value;
    setValue("");
    set.mutate({ value: sent });
  };
  return (
    <Card title="Credential" subtitle={credentialWords(connection.credential)}>
      <ConfirmDialog open={confirming} title="Remove this credential?" confirmLabel="Remove" destructive busy={clear.isPending} onCancel={() => setConfirming(false)} onConfirm={() => clear.mutate(undefined, { onSettled: () => setConfirming(false) })}>
        {connection.credential.from === "vault" ? "The credential is deleted from this machine's OS secret store." : "Orbit forgets which environment variable to read; the variable itself is yours and stays."} Reports stop reading this source until a credential is set again.
      </ConfirmDialog>
      {provider && (
        <MessageBar intent="info" layout="multiline">
          <MessageBarBody>
            <Text weight="semibold">{provider.credential.kind}. </Text>
            {provider.credential.advice}{" "}
            {provider.credential.docs.map((d, i) => (
              <span key={d}>
                {i > 0 && " · "}
                <Link href={d} target="_blank" rel="noreferrer noopener">
                  {docLabel(d)}
                </Link>
              </span>
            ))}
          </MessageBarBody>
        </MessageBar>
      )}
      {backend && (
        <div className={styles.actions}>
          <Field label={`Store a credential in the ${BACKEND_LABEL[backend] ?? backend}`}>
            <Input type="password" autoComplete="off" value={value} onChange={(_, d) => setValue(d.value)} aria-label="Credential" />
          </Field>
          <Button appearance="primary" disabled={readOnly || !value || set.isPending} onClick={store}>
            {set.isPending ? "Storing…" : connection.credential.set ? "Replace" : "Store"}
          </Button>
        </div>
      )}
      <div className={styles.actions}>
        <Field label="Or read it from an environment variable" hint="The variable's NAME, e.g. REPORT_GITHUB_PAT — you set its value in your own shell.">
          <Input value={env} onChange={(_, d) => setEnv(d.value)} aria-label="Environment variable" />
        </Field>
        <Button disabled={readOnly || !env.trim() || set.isPending} onClick={() => set.mutate({ env: env.trim() })}>
          Use this variable
        </Button>
        {connection.credential.set && (
          <Button icon={<Delete20Regular />} disabled={readOnly} onClick={() => setConfirming(true)}>
            Remove credential
          </Button>
        )}
      </div>
      {set.isSuccess && <Caption1>{set.data.connection.credential.from === "vault" ? "Stored. It will not be shown again." : "Saved: the credential is read from that variable when a report runs."}</Caption1>}
      {set.isError && <ErrorState error={set.error} title="The credential was not set" />}
      {clear.isError && <ErrorState error={clear.error} title="The credential was not removed" />}
    </Card>
  );
}

function TestCard({ connection }: { connection: Connection }) {
  const test = useConnectionChange(() => connectionsApi.test(connection.id));
  const shown = newerTest(test.data, connection.lastTest);
  return (
    <Card title="Test" subtitle="Authentication first, then each thing this project's report reads — with the permission it lacks, if any." action={<Button icon={<PlugConnected20Regular />} disabled={!mutationToken() || test.isPending} onClick={() => test.mutate(undefined)}>{test.isPending ? "Testing…" : "Test connection"}</Button>}>
      {test.isError && <ErrorState error={test.error} title="The test did not finish" />}
      {shown ? <Checks test={shown} /> : <Caption1>Not tested yet.</Caption1>}
    </Card>
  );
}

function DeleteCard({ connection }: { connection: Connection }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const remove = useConnectionChange(() => connectionsApi.remove(connection.id));
  return (
    <Card title="Delete">
      <ConfirmDialog open={confirming} title={`Delete ${connection.id}?`} confirmLabel="Delete" destructive busy={remove.isPending} onCancel={() => setConfirming(false)} onConfirm={() => remove.mutate(undefined, { onSuccess: () => navigate(CONNECTIONS_PATH), onSettled: () => setConfirming(false) })}>
        The connection and the credential Orbit stored for it are deleted. A project whose report names it will need another.
      </ConfirmDialog>
      <div>
        <Button icon={<Delete20Regular />} disabled={!mutationToken()} onClick={() => setConfirming(true)}>
          Delete connection
        </Button>
      </div>
      {remove.isError && <ErrorState error={remove.error} title="Not deleted" />}
    </Card>
  );
}
