// THE FIRST PAGE, before anything of an account opens: Orbit's OWN sign-in -- a username and a password Orbit keeps as a
// slow hash -- or, on a new installation, the first administrator, made with the one-time code an operator prints in a
// terminal of the server. Signing in to Orbit never starts a provider's sign-in: Claude Code, Codex and Antigravity are
// connected later, in Settings → AI Connections, when the owner chooses to.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text } from "@fluentui/react-components";
import { Eye16Regular, EyeOff16Regular } from "@fluentui/react-icons";
import { checkSetup, ORBIT_WEB_VERSION, TOO_MANY_ATTEMPTS, type AuthStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { browserTimeZone, TimeZoneSelect } from "../components/TimeZoneSelect";
import { PasswordRules } from "../features/auth/PasswordRules";
import { TrialBar } from "../features/auth/TrialBar";
import { useViewport } from "../hooks/useViewport";
import { ApiError, errorText, send } from "../services/api";
import { useSignInStyles } from "./signInStyles";

// A password field with a button that shows what was typed (to check it) and hides it again.
export function PasswordInput({ value, onChange, autoComplete, label, hint, autoFocus = false }: { value: string; onChange: (v: string) => void; autoComplete: string; label: string; hint?: string; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} hint={hint} required>
      <Input
        type={shown ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(_, d) => onChange(d.value)}
        contentAfter={<Button appearance="transparent" size="small" icon={shown ? <EyeOff16Regular /> : <Eye16Regular />} aria-label={shown ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`} onClick={() => setShown(!shown)} />}
      />
    </Field>
  );
}

function LoginForm({ onStatus, onReload }: { onStatus: (s: AuthStatus) => void; onReload: () => void }) {
  const s = useSignInStyles();
  const { isMobile, isCoarse } = useViewport();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; throttled: boolean } | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onStatus(await send<AuthStatus>("POST", "/api/auth/login", { username: username.trim(), password }));
    } catch (err) {
      // An installation nobody set up yet: the page reads its state again, and shows the setup.
      if (err instanceof ApiError && err.code === "setup_required") onReload();
      setError({ text: errorText(err), throttled: err instanceof ApiError && err.code === TOO_MANY_ATTEMPTS });
      setPassword("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.form}
      aria-label="Sign in"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="Username" required>
        <Input value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!isMobile && !isCoarse} onChange={(_, d) => setUsername(d.value)} />
      </Field>
      <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && (
        <MessageBar intent={error.throttled ? "warning" : "error"}>
          <MessageBarBody>{error.text}</MessageBarBody>
        </MessageBar>
      )}
      {busy ? (
        <Spinner size="tiny" label="Signing in…" />
      ) : (
        <Button className={s.wide} appearance="primary" size="large" type="submit" disabled={username.trim().length === 0 || password.length === 0}>
          Sign in
        </Button>
      )}
      <Text size={200} className={s.hint}>
        Forgot the password? An operator issues a new one-time code on the server: <span className={s.code}>node dist/cli/governance.js owner reset-password</span>.
      </Text>
    </form>
  );
}

function SetupForm({ onStatus }: { onStatus: (s: AuthStatus) => void }) {
  const s = useSignInStyles();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("admin");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [timezone, setTimezone] = useState(browserTimeZone);
  const [contactEmail, setContactEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const body = { code: code.trim(), username: username.trim().toLowerCase(), password, fullName: fullName.trim(), companyName: companyName.trim(), timezone, contactEmail: contactEmail.trim() === "" ? null : contactEmail.trim() };
  const mismatch = confirm.length > 0 && confirm !== password;
  const submit = async () => {
    // The contract's own check first: the page says every problem at once, before anything is sent.
    const checked = checkSetup(body);
    if (!checked.ok || confirm !== password) {
      setProblems([...(checked.ok ? [] : checked.errors), ...(confirm !== password ? ["the two passwords differ"] : [])]);
      return;
    }
    setProblems([]);
    setBusy(true);
    setError(null);
    try {
      onStatus(await send<AuthStatus>("POST", "/api/auth/setup", body));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.form}
      aria-label="Set up the first administrator"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label="One-time setup code" required hint="Printed on the server by node dist/cli/governance.js owner setup-code — valid for 30 minutes, and used once.">
        <Input value={code} autoComplete="one-time-code" spellCheck={false} onChange={(_, d) => setCode(d.value)} />
      </Field>
      <Field label="Username" required hint="Lower-case letters, digits, dots, dashes or underscores, starting with a letter.">
        <Input value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(_, d) => setUsername(d.value)} />
      </Field>
      <Field label="Full name" required>
        <Input value={fullName} autoComplete="name" onChange={(_, d) => setFullName(d.value)} />
      </Field>
      <Field label="Company name" hint="Optional.">
        <Input value={companyName} autoComplete="organization" onChange={(_, d) => setCompanyName(d.value)} />
      </Field>
      <Field label="Time zone" required hint="The default of your schedules. It starts as this browser's.">
        <TimeZoneSelect value={timezone} onChange={setTimezone} />
      </Field>
      <Field label="Contact email" hint="Optional. It stays unverified until Orbit can send mail.">
        <Input type="email" value={contactEmail} autoComplete="email" onChange={(_, d) => setContactEmail(d.value)} />
      </Field>
      <PasswordInput label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
      <PasswordRules password={password} username={username.trim().toLowerCase()} />
      <Field label="Repeat the password" required validationState={mismatch ? "error" : "none"} validationMessage={mismatch ? "The two passwords differ." : undefined}>
        <Input type="password" value={confirm} autoComplete="new-password" onChange={(_, d) => setConfirm(d.value)} />
      </Field>
      {problems.length > 0 && (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            <ul aria-label="What to correct" style={{ margin: 0, paddingLeft: "18px" }}>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {busy ? (
        <Spinner size="tiny" label="Creating the administrator…" />
      ) : (
        <Button className={s.wide} appearance="primary" size="large" type="submit">
          Create the administrator
        </Button>
      )}
    </form>
  );
}

export function SignInPage({ status, onStatus, onReload }: { status: AuthStatus; onStatus: (s: AuthStatus) => void; onReload: () => void }) {
  const s = useSignInStyles();
  const setup = status.state === "setup_required";
  return (
    <div className={`${s.root} orbit-touch`}>
      <TrialBar trial={status.trial} />
      <main className={s.page}>
        <div className={s.panel}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <h1 className={s.heading}>{setup ? "Set up Orbit Web" : "Sign in to Orbit Web"}</h1>
          <Text align="center" className={s.lead}>
            {setup
              ? "Create the first administrator of this installation. You connect Claude Code, Codex or Antigravity afterwards, in Settings → AI Connections."
              : "Sign in with your Orbit username and password. This is Orbit's own sign-in: no AI provider is asked, and none is started."}
          </Text>
        </div>
        <section className={s.card} aria-label={setup ? "Set up the first administrator" : "Sign in to Orbit Web"}>
          {setup ? <SetupForm onStatus={onStatus} /> : <LoginForm onStatus={onStatus} onReload={onReload} />}
        </section>
        <Text size={200} className={s.foot}>
          Orbit Web {ORBIT_WEB_VERSION}
        </Text>
      </main>
    </div>
  );
}
