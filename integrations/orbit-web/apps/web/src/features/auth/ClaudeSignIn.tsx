// The sign-in of Orbit Web, which is the Claude account's: `claude auth login --claudeai`, verified by
// `claude auth status`. The page shows the URL the CLI printed and hands the code a person pastes to that process,
// and nothing else. There is no other way in: no API key, no token, no Anthropic Console account.
import { Button, Field, Input, Link, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ClaudeStatus, LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { flowActive, useLoginFlow } from "../../hooks/useLoginFlow";
import { errorText, send } from "../../services/api";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end" },
  url: { wordBreak: "break-all" },
  hint: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, whiteSpace: "nowrap" },
});

export function ClaudeSignIn({ status, onChanged }: { status: ClaudeStatus | null; onChanged: () => void }) {
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
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.body}>
      {status?.state === "unavailable" && (
        <MessageBar intent="warning">
          <MessageBarBody>The Claude CLI did not answer: {status.detail ?? "no reason given"}</MessageBarBody>
        </MessageBar>
      )}
      {status?.state !== "unavailable" && status?.detail && <Text size={200} className={s.hint}>{status.detail}</Text>}
      <FlowView flow={flow} code={code} setCode={setCode} onSubmit={() => act(() => send("POST", "/api/claude/login/code", { code }).then(() => setCode("")))} onCancel={() => act(() => send("POST", "/api/claude/login/cancel"))} busy={busy} />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {!flowActive(flow) && (
        <div>
          <Button appearance="primary" size="large" disabled={busy} onClick={() => act(() => send<LoginSnapshot>("POST", "/api/claude/login"))}>
            Sign in with Claude
          </Button>
        </div>
      )}
      <Text size={200} className={s.hint}>
        If signing in here does not finish, sign in from a terminal instead: <span className={s.mono}>docker exec -it orbit-web claude auth login --claudeai</span>, then reload this page.
      </Text>
    </div>
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
        <Text>1. Open this link and sign in with your Claude account:</Text>
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
