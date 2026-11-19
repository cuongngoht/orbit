// Claude Account: signed in through `claude auth login`, verified by `claude auth status`.
import { Button, Card, CardHeader, Field, Input, Link, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ClaudeStatus, LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ConnectionBadge } from "../../components/StatusBadge";
import { errorText, send } from "../../services/api";
import { flowActive, useLoginFlow } from "../../hooks/useLoginFlow";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: "10px" },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" },
  url: { wordBreak: "break-all" },
  hint: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
});

export function ClaudeCard({ status, onChanged }: { status: ClaudeStatus | null; onChanged: () => void }) {
  const s = useStyles();
  const flow = useLoginFlow("claude", status?.flow ?? null);
  const [code, setCode] = useState("");
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
    <Card aria-label="Claude Account">
      <CardHeader header={<Text weight="semibold">Claude Account</Text>} description={status ? <ConnectionBadge state={status.state} /> : <Spinner size="tiny" />} />
      <div className={s.body}>
        {status?.method && connected && (
          <Text size={200} className={s.hint}>
            Signed in ({status.method}){status.source === "environment" ? " through a credential the container was started with" : ""}.
          </Text>
        )}
        {status?.detail && !connected && <Text size={200} className={s.hint}>{status.detail}</Text>}
        <FlowView flow={flow} code={code} setCode={setCode} onSubmit={() => act(() => send("POST", "/api/claude/login/code", { code }).then(() => setCode("")))} onCancel={() => act(() => send("POST", "/api/claude/login/cancel"))} busy={busy} />
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        {!flowActive(flow) && (
          <div className={s.row}>
            <Button appearance={connected ? "secondary" : "primary"} disabled={busy} onClick={() => act(() => send<LoginSnapshot>("POST", "/api/claude/login", { mode: "claudeai" }))}>
              {connected ? "Reconnect Claude" : "Connect Claude"}
            </Button>
            {!connected && (
              <Button appearance="subtle" disabled={busy} onClick={() => act(() => send<LoginSnapshot>("POST", "/api/claude/login", { mode: "console" }))}>
                Use an Anthropic Console account
              </Button>
            )}
            {connected && status?.source !== "environment" && (
              <Button appearance="subtle" disabled={busy} onClick={() => act(() => send("POST", "/api/claude/logout"))}>
                Sign out
              </Button>
            )}
          </div>
        )}
        <Text size={200} className={s.hint}>
          If signing in here does not finish, sign in from a terminal instead: <span className={s.mono}>docker exec -it orbit-web claude auth login</span>
        </Text>
      </div>
    </Card>
  );
}

function FlowView(p: { flow: LoginSnapshot | null; code: string; setCode: (v: string) => void; onSubmit: () => void; onCancel: () => void; busy: boolean }) {
  const s = useStyles();
  const f = p.flow;
  if (f === null || f.state === "idle" || f.state === "connected") return null;
  if (f.state === "starting") return <Spinner size="tiny" label="Starting the Claude CLI's sign-in…" />;
  if (f.state === "verifying") return <Spinner size="tiny" label={f.message ?? "Checking the sign-in…"} />;
  if (f.state === "awaiting_user")
    return (
      <div className={s.body}>
        <Text>1. Open this link and sign in to Claude:</Text>
        {f.url && (
          <Link href={f.url} target="_blank" rel="noopener noreferrer" className={s.url}>
            {f.url}
          </Link>
        )}
        {f.message && <Text size={200}>{f.message}</Text>}
        {f.needsCode && (
          <form
            className={s.row}
            onSubmit={(e) => {
              e.preventDefault();
              p.onSubmit();
            }}
          >
            <Field label="2. Paste the code the page shows">
              <Input value={p.code} onChange={(_, d) => p.setCode(d.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Button type="submit" appearance="primary" disabled={p.busy || p.code.trim().length === 0}>
              Submit code
            </Button>
          </form>
        )}
        <div>
          <Button appearance="subtle" onClick={p.onCancel} disabled={p.busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <MessageBar intent={f.state === "cancelled" ? "info" : "error"}>
      <MessageBarBody>{f.message ?? `Sign-in ${f.state.replace("_", " ")}.`}</MessageBarBody>
    </MessageBar>
  );
}
