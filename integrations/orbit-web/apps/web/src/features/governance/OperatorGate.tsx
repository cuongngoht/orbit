// THE OPERATOR'S SIGN-IN, separate from the Claude sign-in: the Claude account opens the workspace; governance is
// administered only by a person Orbit Web verified itself. Until an owner exists the first owner is enrolled here with
// the one-time code Orbit Web printed in its own log (`docker logs orbit-web`) -- the code is never shown on a
// page and never given to Claude Code.
import { Button, Field, Input, MessageBar, MessageBarBody, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Eye16Regular, EyeOff16Regular, ShieldKeyhole24Regular } from "@fluentui/react-icons";
import type { GovernanceState } from "@orbit-web/contracts";
import { useState, type FormEvent } from "react";
import { errorText, send } from "../../services/api";
import { acceptOperatorState } from "../../services/operator";

const useStyles = makeStyles({
  wrap: {
    minHeight: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: "24px",
    paddingBottom: "32px",
    paddingLeft: "16px",
    paddingRight: "16px",
    "@media (max-width: 639px)": {
      alignItems: "flex-start",
      paddingTop: "12px",
      paddingLeft: "4px",
      paddingRight: "4px",
    },
  },
  card: {
    width: "100%",
    maxWidth: "440px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    paddingTop: "28px",
    paddingBottom: "26px",
    paddingLeft: "26px",
    paddingRight: "26px",
    "@media (max-width: 639px)": {
      paddingTop: "20px",
      paddingBottom: "20px",
      paddingLeft: "18px",
      paddingRight: "18px",
    },
    borderRadius: "20px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-composer-shadow)",
  },
  head: { display: "flex", gap: "12px", alignItems: "center" },
  emblem: {
    width: "38px",
    height: "38px",
    borderRadius: "12px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  heading: { letterSpacing: "-0.02em" },
  lead: { color: tokens.colorNeutralForeground2, lineHeight: "1.5" },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12.5px",
    backgroundColor: tokens.colorNeutralBackground3,
    paddingTop: "2px",
    paddingRight: "6px",
    paddingBottom: "2px",
    paddingLeft: "6px",
    borderRadius: "6px",
  },
  input: {
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "40px" },
  },
  submit: { minHeight: "42px", borderRadius: "10px", marginTop: "4px" },
  footNote: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "10px",
    paddingTop: "10px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    paddingRight: "12px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.45",
  },
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
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, submit } = useSubmit("/api/operator/bootstrap", () => ({ code, organizationName, username, displayName: displayName || username, password }));
  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit} aria-label="Enrol the first owner">
        <div className={s.head}>
          <span className={s.emblem} aria-hidden>
            <ShieldKeyhole24Regular />
          </span>
          <Text weight="semibold" size={500} className={s.heading}>
            Enrol governance's first owner
          </Text>
        </div>
        <Text className={s.lead}>
          Governance has no owner yet. The one-time code is in Orbit Web's own log, where only whoever runs the container can read it: in a
          terminal, from any folder, <code className={s.code}>docker logs orbit-web</code> (the governed deployment:{" "}
          <code className={s.code}>docker compose -f compose.governed.yaml logs orbit-web</code>), or Docker Desktop → Containers → orbit-web →
          Logs. It works once, until Orbit Web restarts.
        </Text>
        <Field label="One-time code" required>
          <Input className={s.input} value={code} onChange={(_, d) => setCode(d.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Organization" required>
          <Input className={s.input} value={organizationName} onChange={(_, d) => setOrganization(d.value)} />
        </Field>
        <Field label="Your username" required hint="Lower-case letters, digits, dots, dashes, underscores.">
          <Input className={s.input} value={username} onChange={(_, d) => setUsername(d.value.toLowerCase())} autoComplete="username" />
        </Field>
        <Field label="Your name">
          <Input className={s.input} value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
        </Field>
        <Field label="Password" required hint="At least 12 characters. Kept only as a slow hash.">
          <Input
            className={s.input}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(_, d) => setPassword(d.value)}
            autoComplete="new-password"
            contentAfter={
              <Button
                type="button"
                appearance="transparent"
                size="small"
                icon={showPassword ? <EyeOff16Regular /> : <Eye16Regular />}
                aria-label={showPassword ? "Hide value" : "Show value"}
                onClick={() => setShowPassword((v) => !v)}
              />
            }
          />
        </Field>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <Button className={s.submit} appearance="primary" type="submit" disabled={busy || code.trim() === "" || username === "" || password.length < 12 || organizationName.trim() === ""}>
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
  const [showPassword, setShowPassword] = useState(false);
  const { busy, error, submit } = useSubmit("/api/operator/login", () => ({ username, password }));
  return (
    <div className={s.wrap}>
      <form className={s.card} onSubmit={submit} aria-label="Operator sign-in">
        <div className={s.head}>
          <span className={s.emblem} aria-hidden>
            <ShieldKeyhole24Regular />
          </span>
          <Text weight="semibold" size={500} className={s.heading}>
            Sign in to governance
          </Text>
        </div>
        <Text className={s.lead}>
          {organization ? `${organization}'s` : "This"} governance is administered by its operators, each signed in with their own credential -- the Claude account
          this Orbit Web uses is not one.
        </Text>
        <Field label="Username" required>
          <Input className={s.input} value={username} onChange={(_, d) => setUsername(d.value.toLowerCase())} autoComplete="username" />
        </Field>
        <Field label="Password" required>
          <Input
            className={s.input}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(_, d) => setPassword(d.value)}
            autoComplete="current-password"
            contentAfter={
              <Button
                type="button"
                appearance="transparent"
                size="small"
                icon={showPassword ? <EyeOff16Regular /> : <Eye16Regular />}
                aria-label={showPassword ? "Hide value" : "Show value"}
                onClick={() => setShowPassword((v) => !v)}
              />
            }
          />
        </Field>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <Button className={s.submit} appearance="primary" type="submit" disabled={busy || username === "" || password === ""}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <div className={s.footNote}>
          <Text size={200}>
            Locked out? The installation's own terminal resets an owner's password: <code className={s.code}>governance.js reset-password</code> (README).
          </Text>
        </div>
      </form>
    </div>
  );
}
