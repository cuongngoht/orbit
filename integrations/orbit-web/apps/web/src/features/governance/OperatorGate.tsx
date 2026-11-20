// THE OPERATOR'S SIGN-IN, separate from the Claude sign-in: the Claude account opens the workspace; governance is
// administered only by a person Orbit Web verified itself. Until an owner exists the first owner is enrolled here with
// the one-time code Orbit Web printed in its own log (`docker logs orbit-web`) -- the code is never shown on a
// page and never given to Claude Code.
import { Button, Field, Input, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ShieldKeyhole24Regular } from "@fluentui/react-icons";
import type { GovernanceState } from "@orbit-web/contracts";
import { useState, type FormEvent } from "react";
import { errorText, send } from "../../services/api";
import { acceptOperatorState } from "../../services/operator";

const useStyles = makeStyles({
  wrap: { display: "flex", justifyContent: "center", paddingTop: "32px", paddingBottom: "32px", paddingLeft: "16px", paddingRight: "16px" },
  card: {
    width: "100%",
    maxWidth: "440px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    paddingTop: "24px",
    paddingBottom: "24px",
    paddingLeft: "24px",
    paddingRight: "24px",
    borderRadius: "16px",
    borderTopWidth: "1px",
    borderRightWidth: "1px",
    borderBottomWidth: "1px",
    borderLeftWidth: "1px",
    borderTopStyle: "solid",
    borderRightStyle: "solid",
    borderBottomStyle: "solid",
    borderLeftStyle: "solid",
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
  },
  head: { display: "flex", gap: "10px", alignItems: "center" },
  muted: { color: tokens.colorNeutralForeground3 },
  code: { fontFamily: tokens.fontFamilyMonospace },
});

function useSubmit(path: string, body: () => unknown): { busy: boolean; error: string | null; submit: (e: FormEvent) => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    void send<GovernanceState>("POST", path, body())
      .then(acceptOperatorState)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  return { busy, error, submit };
}

export function BootstrapForm() {
  const s = useStyles();
  const [code, setCode] = useState("");
  const [organizationName, setOrganization] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit("/api/operator/bootstrap", () => ({ code, organizationName, username, displayName: displayName || username, password }));
  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit} aria-label="Enrol the first owner">
        <div className={s.head}>
          <ShieldKeyhole24Regular />
          <Text weight="semibold" size={500}>
            Enrol governance's first owner
          </Text>
        </div>
        <Text className={s.muted}>
          Governance has no owner yet. The one-time code is in Orbit Web's own log, where only whoever runs the container can read it: in a
          terminal, from any folder, <span className={s.code}>docker logs orbit-web</span> (the governed deployment:{" "}
          <span className={s.code}>docker compose -f compose.governed.yaml logs orbit-web</span>), or Docker Desktop → Containers → orbit-web →
          Logs. It works once, until Orbit Web restarts.
        </Text>
        <Field label="One-time code" required>
          <Input value={code} onChange={(_, d) => setCode(d.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Organization" required>
          <Input value={organizationName} onChange={(_, d) => setOrganization(d.value)} />
        </Field>
        <Field label="Your username" required hint="Lower-case letters, digits, dots, dashes, underscores.">
          <Input value={username} onChange={(_, d) => setUsername(d.value.toLowerCase())} autoComplete="username" />
        </Field>
        <Field label="Your name">
          <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
        </Field>
        <Field label="Password" required hint="At least 12 characters. Kept only as a slow hash.">
          <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} autoComplete="new-password" />
        </Field>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" type="submit" disabled={busy || code.trim() === "" || username === "" || password.length < 12 || organizationName.trim() === ""}>
          {busy ? "Enrolling…" : "Enrol as owner"}
        </Button>
      </form>
    </div>
  );
}

export function SignInForm({ organization }: { organization: string | null }) {
  const s = useStyles();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { busy, error, submit } = useSubmit("/api/operator/login", () => ({ username, password }));
  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit} aria-label="Operator sign-in">
        <div className={s.head}>
          <ShieldKeyhole24Regular />
          <Text weight="semibold" size={500}>
            Sign in to governance
          </Text>
        </div>
        <Text className={s.muted}>
          {organization ? `${organization}'s` : "This"} governance is administered by its operators, each signed in with their own credential -- the Claude account
          this Orbit Web uses is not one.
        </Text>
        <Field label="Username" required>
          <Input value={username} onChange={(_, d) => setUsername(d.value.toLowerCase())} autoComplete="username" />
        </Field>
        <Field label="Password" required>
          <Input type="password" value={password} onChange={(_, d) => setPassword(d.value)} autoComplete="current-password" />
        </Field>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" type="submit" disabled={busy || username === "" || password === ""}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Text size={200} className={s.muted}>
          Locked out? The installation's own terminal resets an owner's password: governance.js reset-password (README).
        </Text>
      </form>
    </div>
  );
}
