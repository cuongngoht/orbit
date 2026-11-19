// GitHub Connection: GitHub CLI's own browser sign-in (device flow), verified by `gh auth status` and `gh api user`.
import { Button, Card, CardHeader, Link, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { GitHubStatus, LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ConnectionBadge } from "../../components/StatusBadge";
import { errorText, send } from "../../services/api";
import { flowActive, useLoginFlow } from "../../hooks/useLoginFlow";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeHero700, letterSpacing: "4px", fontWeight: tokens.fontWeightSemibold },
  hint: { color: tokens.colorNeutralForeground3 },
});

export function GitHubCard({ status, onChanged }: { status: GitHubStatus | null; onChanged: () => void }) {
  const s = useStyles();
  const flow = useLoginFlow("github", status?.flow ?? null);
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
  return (
    <Card aria-label="GitHub Connection">
      <CardHeader header={<Text weight="semibold">GitHub Connection</Text>} description={status ? <ConnectionBadge state={status.state} /> : <Spinner size="tiny" />} />
      <div className={s.body}>
        {connected && status?.account && (
          <Text>
            Connected as <strong>@{status.account.login}</strong>
            {status.account.name ? ` (${status.account.name})` : ""}
          </Text>
        )}
        {status?.state === "expired" && (
          <MessageBar intent="warning">
            <MessageBarBody>{status.detail ?? "The GitHub sign-in has expired."} Your chats are kept; connect again to continue.</MessageBarBody>
          </MessageBar>
        )}
        {status?.state === "unavailable" && status.detail && <Text size={200} className={s.hint}>{status.detail}</Text>}
        <DeviceFlow flow={flow} onCancel={() => act(() => send("POST", "/api/github/login/cancel"))} busy={busy} />
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!flowActive(flow) && (
          <div className={s.row}>
            {!connected && (
              <Button appearance="primary" disabled={busy} onClick={() => act(() => send<LoginSnapshot>("POST", "/api/github/login"))}>
                Connect GitHub
              </Button>
            )}
            {connected && (
              <Button appearance="secondary" disabled={busy} onClick={() => act(() => send("POST", "/api/github/logout"))}>
                Disconnect
              </Button>
            )}
          </div>
        )}
        <Text size={200} className={s.hint}>
          Uses GitHub CLI's own sign-in; no GitHub App and no personal access token. Disconnecting ends the CLI's sign-in in this container; to revoke the authorization itself, use GitHub's Settings → Applications.
        </Text>
      </div>
    </Card>
  );
}

function DeviceFlow({ flow, onCancel, busy }: { flow: LoginSnapshot | null; onCancel: () => void; busy: boolean }) {
  const s = useStyles();
  if (flow === null || flow.state === "idle" || flow.state === "connected") return null;
  if (flow.state === "starting") return <Spinner size="tiny" label="Starting GitHub CLI's sign-in…" />;
  if (flow.state === "verifying") return <Spinner size="tiny" label={flow.message ?? "Checking the sign-in with gh…"} />;
  if (flow.state === "awaiting_user")
    return (
      <div className={s.body}>
        <Text>
          Open{" "}
          <Link href={flow.url ?? "#"} target="_blank" rel="noopener noreferrer">
            {flow.url}
          </Link>{" "}
          and enter the code displayed by GitHub CLI:
        </Text>
        <Text className={s.code} aria-label="one-time code">
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
