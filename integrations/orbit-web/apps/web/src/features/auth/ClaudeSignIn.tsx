// The sign-in of Orbit Web, which is the Claude account's -- and this BROWSER's: `claude auth login --claudeai`, verified
// by `claude auth status`, then exchanged for this browser's session (POST /api/claude/session). The page starts that
// sign-in by itself when nothing is under way (never again after a person cancelled it or it failed: then Continue with
// Claude does), shows the whole URL the CLI printed to open or copy, and hands the code a person pastes to that process,
// and nothing else. Even when the CLI is signed in already (a terminal, another browser), this browser signs in itself:
// the CLI being signed in is not this browser being signed in. There is no other way in: no API key, no token, no Orbit
// password, no registration.
import { Button, Field, Input, Link, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ClaudeStatus, LoginSnapshot } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { flowActive, newer, useClaudeLoginFlow } from "../../hooks/useLoginFlow";
import { errorText, send } from "../../services/api";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: "12px", textAlign: "left" },
  continue: { width: "100%", borderRadius: tokens.borderRadiusXLarge, "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" } },
  row: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end", "@media (max-width: 639px)": { flexDirection: "column", alignItems: "stretch" } },
  codeField: { flexGrow: 1, minWidth: 0 },
  actionBtn: { "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" } },
  url: { wordBreak: "break-all" },
  link: { display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px", borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground3 },
  hint: { color: tokens.colorNeutralForeground3 },
});

export function ClaudeSignIn({ status, onChanged }: { status: ClaudeStatus | null; onChanged: () => void }) {
  const s = useStyles();
  const [started, setStarted] = useState<LoginSnapshot | null>(null);
  const flow = newer(useClaudeLoginFlow(status?.flow ?? null), started);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A verified sign-in is exchanged, once, for this browser's session; a failed one shows why.
  const claimed = useRef<string | null>(null);
  useEffect(() => {
    if (flow?.state === "failed") onChanged();
    if (flow?.state !== "connected" || claimed.current === flow.updatedAt) return;
    claimed.current = flow.updatedAt;
    void send<ClaudeStatus>("POST", "/api/claude/session")
      .then(() => onChanged())
      .catch((err: unknown) => {
        setError(errorText(err));
        onChanged();
      });
  }, [flow?.state, flow?.updatedAt, onChanged]);

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

  const begin = () => act(() => send<LoginSnapshot>("POST", "/api/claude/login").then(setStarted));

  // Once, on arrival: a signed-out Orbit Web with no sign-in under way opens one, so its link is there to click.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !startsByItself(status)) return;
    opened.current = true;
    void begin();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

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
        <Button className={s.continue} appearance="primary" size="large" disabled={busy} onClick={() => void begin()}>
          Continue with Claude
        </Button>
      )}
      <Text size={200} className={s.hint}>
        Orbit Web keeps no password of its own: your Claude account is your sign-in, and this browser stays signed in until you sign it out or its session ends.
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
        {f.url && <AuthorizeLink url={f.url} />}
        {f.message && <Text size={200}>{f.message}</Text>}
        {f.needsCode && (
          <form
            className={s.row}
            onSubmit={(e) => {
              e.preventDefault();
              p.onSubmit();
            }}
          >
            <Field className={s.codeField} label="2. Paste the code the page shows">
              <Input value={p.code} onChange={(_, d) => p.setCode(d.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Button className={s.actionBtn} type="submit" appearance="primary" disabled={p.busy || p.code.trim().length === 0}>
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

// Only a browser with no session whose sign-in never began starts one by itself.
function startsByItself(status: ClaudeStatus | null): boolean {
  if (status === null || status.state !== "not_connected") return false;
  return (status.flow?.state ?? "idle") === "idle";
}

// The whole authorize URL, as a link to open in a new tab and a button that copies it (for another browser or device).
function AuthorizeLink({ url }: { url: string }) {
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={s.link}>
      <Link href={url} target="_blank" rel="noopener noreferrer" className={s.url}>
        {url}
      </Link>
      <div>
        <Button size="small" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
    </div>
  );
}
