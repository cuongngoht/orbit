// Azure Account (optional): the Azure CLI's own device sign-in (`az login --use-device-code`), verified by
// `az account show`. Claude Code is given this sign-in only when the switch below is on.
import { Button, Card, CardHeader, Field, Input, Link, MessageBar, MessageBarBody, Spinner, Switch, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { AzureStatus, LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ConnectionBadge } from "../../components/StatusBadge";
import { errorText, send } from "../../services/api";
import { flowActive, useLoginFlow } from "../../hooks/useLoginFlow";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeHero700, letterSpacing: "4px", fontWeight: tokens.fontWeightSemibold },
  hint: { color: tokens.colorNeutralForeground3 },
});

export function AzureCard({ status, onChanged }: { status: AzureStatus | null; onChanged: () => void }) {
  const s = useStyles();
  const flow = useLoginFlow("azure", status?.flow ?? null);
  const [tenant, setTenant] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (flow?.state === "connected" || flow?.state === "failed") onChanged();
  }, [flow?.state, onChanged]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.state === "connected";
  const installed = status?.state !== "unavailable" || !/not installed/.test(status?.detail ?? "");
  return (
    <Card aria-label="Azure Account">
      <CardHeader header={<Text weight="semibold">Azure Account (optional)</Text>} description={status ? <ConnectionBadge state={status.state} /> : <Spinner size="tiny" />} />
      <div className={s.body}>
        {connected && status?.account && (
          <Text>
            Signed in as <strong>{status.account.user}</strong>
            {status.account.subscription ? ` · ${status.account.subscription}` : ""}
          </Text>
        )}
        {status?.detail && !connected && <Text size={200} className={s.hint}>{status.detail}</Text>}
        <DeviceFlow flow={flow} onCancel={() => act(() => send("POST", "/api/azure/login/cancel"))} busy={busy} />
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {installed && !flowActive(flow) && !connected && (
          <form
            className={s.row}
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => send<LoginSnapshot>("POST", "/api/azure/login", tenant.trim() ? { tenant: tenant.trim() } : {}));
            }}
          >
            <Field label="Tenant (optional)">
              <Input value={tenant} onChange={(_, d) => setTenant(d.value)} placeholder="contoso.onmicrosoft.com" autoComplete="off" spellCheck={false} />
            </Field>
            <Button appearance="primary" type="submit" disabled={busy}>
              Connect Azure
            </Button>
          </form>
        )}
        {connected && !flowActive(flow) && (
          <div className={s.row}>
            <Button appearance="secondary" disabled={busy} onClick={() => act(() => send("POST", "/api/azure/logout"))}>
              Sign out
            </Button>
          </div>
        )}
        {status && (
          <Switch
            checked={status.availableToClaude}
            disabled={busy}
            onChange={(_, d) => void act(() => send("PATCH", "/api/settings", { azureForClaude: d.checked }))}
            label="Let Claude Code use this Azure sign-in"
          />
        )}
        <Text size={200} className={s.hint}>
          Uses the Azure CLI's own sign-in, kept in this container. With the switch on, Claude Code may run <code>az</code> as this account in any chat -- including against resources that matter -- so turn it on only for accounts and repositories you trust. Orbit's own Azure connections keep a sign-in of their own.
        </Text>
      </div>
    </Card>
  );
}

function DeviceFlow({ flow, onCancel, busy }: { flow: LoginSnapshot | null; onCancel: () => void; busy: boolean }) {
  const s = useStyles();
  if (flow === null || flow.state === "idle" || flow.state === "connected") return null;
  if (flow.state === "starting") return <Spinner size="tiny" label="Starting the Azure CLI's sign-in…" />;
  if (flow.state === "verifying") return <Spinner size="tiny" label={flow.message ?? "Checking the sign-in with az…"} />;
  if (flow.state === "awaiting_user")
    return (
      <div className={s.body}>
        <Text>
          Open{" "}
          <Link href={flow.url ?? "#"} target="_blank" rel="noopener noreferrer">
            {flow.url}
          </Link>{" "}
          and enter the code the Azure CLI displayed:
        </Text>
        <Text className={s.code} aria-label="Azure one-time code">
          {flow.code}
        </Text>
        <Spinner size="tiny" label="Waiting for authorization…" labelPosition="after" />
        <div>
          <Button appearance="subtle" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <MessageBar intent={flow.state === "cancelled" ? "info" : "error"}>
      <MessageBarBody>{flow.message ?? `Sign-in ${flow.state.replace("_", " ")}.`}</MessageBarBody>
    </MessageBar>
  );
}
