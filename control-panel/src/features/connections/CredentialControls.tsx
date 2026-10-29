import { useState } from "react";
import { Button, Caption1, Field, Input, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Delete20Regular } from "@fluentui/react-icons";
import { mutationToken } from "../../shared/api/client";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { ErrorState } from "../../shared/components/ErrorState";
import { connectionsApi, useConnectionChange, useSetCredential } from "./connections.api";
import type { Connection, Provider } from "./connections.types";
import { BACKEND_LABEL, credentialWords, docLabel } from "./connectionWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap", alignItems: "end" },
});

// The credential a connection reads when it does not sign in: stored once in this machine's OS secret store, or named as an
// environment variable the person sets. The value is held in this component only until it is sent, then cleared -- it is never put
// in the query cache, and it is never shown again.
export function CredentialControls({ connection, provider, backend }: { connection: Connection; provider: Provider | undefined; backend: string | null }) {
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
    <div className={styles.stack}>
      <Caption1>{credentialWords(connection.credential)}</Caption1>
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
    </div>
  );
}
