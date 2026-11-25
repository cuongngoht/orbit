// THE FIRST PAGE, before anything of an account opens: Orbit's OWN sign-in -- a username and a password Orbit keeps as a
// slow hash -- or, on a new installation, the first administrator, made with the one-time code an operator prints in a
// terminal of the server. Signing in to Orbit never starts a provider's sign-in: Claude Code, Codex and Antigravity are
// connected later, in Settings → AI Connections, when the owner chooses to.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Checkmark16Regular, Copy16Regular, Eye16Regular, EyeOff16Regular } from "@fluentui/react-icons";
import { checkSetup, ORBIT_WEB_VERSION, TOO_MANY_ATTEMPTS, type AuthStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { browserTimeZone, TimeZoneSelect } from "../components/TimeZoneSelect";
import { PasswordRules } from "../features/auth/PasswordRules";
import { TrialBar } from "../features/auth/TrialBar";
import { useViewport } from "../hooks/useViewport";
import { useI18n } from "../i18n";
import { ApiError, errorText, send } from "../services/api";
import { useSignInStyles } from "./signInStyles";

const useLocalStyles = makeStyles({
  gridTwo: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "12px",
    alignItems: "start",
    "@media (max-width: 639px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  forgot: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingTop: "10px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  forgotSummary: { cursor: "pointer", userSelect: "none", fontWeight: tokens.fontWeightMedium },
  forgotBody: { marginTop: "6px", display: "flex", flexDirection: "column", gap: "6px" },
  cmdRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", backgroundColor: tokens.colorNeutralBackground2, padding: "6px 8px", borderRadius: "8px" },
});

// A password field with a button that shows what was typed (to check it) and hides it again.
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  label,
  hint,
  autoFocus = false,
  required = true,
  validationState,
  validationMessage,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  label: string;
  hint?: string;
  autoFocus?: boolean;
  required?: boolean;
  validationState?: "error" | "none" | "warning" | "success";
  validationMessage?: string;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const fieldName = label.toLowerCase().replace(/^repeat (?:the )?/, "repeated ");
  return (
    <Field label={label} hint={hint} required={required} validationState={validationState} validationMessage={validationMessage}>
      <Input
        type={shown ? "text" : "password"}
        value={value}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        onChange={(_, d) => onChange(d.value)}
        contentAfter={<Button appearance="transparent" size="small" icon={shown ? <EyeOff16Regular /> : <Eye16Regular />} aria-label={shown ? t("common.signIn.hideField", { label: fieldName }) : t("common.signIn.showField", { label: fieldName })} onClick={() => setShown(!shown)} />}
      />
    </Field>
  );
}

function LoginForm({ onStatus, onReload }: { onStatus: (s: AuthStatus) => void; onReload: () => void }) {
  const { t } = useI18n();
  const s = useSignInStyles();
  const ls = useLocalStyles();
  const { isMobile, isCoarse } = useViewport();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<{ text: string; throttled: boolean } | null>(null);
  const resetCmd = "node dist/cli/governance.js owner reset-password";
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onStatus(await send<AuthStatus>("POST", "/api/auth/login", { username: username.trim(), password }));
    } catch (err) {
      // An installation nobody set up yet: the page reads its state again, and shows the setup.
      if (err instanceof ApiError && err.code === "setup_required") onReload();
      const throttled = err instanceof ApiError && err.code === TOO_MANY_ATTEMPTS;
      setError({ text: errorText(err), throttled });
      if (err instanceof ApiError && !throttled) setPassword("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.form}
      aria-label={t("common.signIn.signInAria")}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field label={t("common.signIn.usernameLabel")} required>
        <Input value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!isMobile && !isCoarse} onChange={(_, d) => setUsername(d.value)} />
      </Field>
      <PasswordInput label={t("common.signIn.passwordLabel")} value={password} onChange={setPassword} autoComplete="current-password" />
      {error && (
        <MessageBar intent={error.throttled ? "warning" : "error"}>
          <MessageBarBody>{error.text}</MessageBarBody>
        </MessageBar>
      )}
      {busy ? (
        <Spinner size="tiny" label={t("common.signIn.signingIn")} />
      ) : (
        <Button className={s.wide} appearance="primary" size="large" type="submit" disabled={username.trim().length === 0 || password.length === 0}>
          {t("common.signIn.signIn")}
        </Button>
      )}
      <details className={ls.forgot}>
        <summary className={ls.forgotSummary}>{t("common.signIn.forgotSummary")}</summary>
        <div className={ls.forgotBody}>
          <Text size={200} className={s.hint}>
            {t("common.signIn.forgotLead")}
          </Text>
          <div className={ls.cmdRow}>
            <span className={s.code} style={{ flexGrow: 1 }}>
              {resetCmd}
            </span>
            <Button
              size="small"
              appearance="subtle"
              icon={copied ? <Checkmark16Regular /> : <Copy16Regular />}
              aria-label={t("common.codeBlock.copy")}
              onClick={() => {
                void navigator.clipboard?.writeText(resetCmd).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? t("common.codeBlock.copied") : t("common.codeBlock.copy")}
            </Button>
          </div>
        </div>
      </details>
    </form>
  );
}

// `standing`: a test installation's standing setup code (ORBIT_WEB_SETUP_CODE), filled in for the first administrator.
function SetupForm({ onStatus, standing }: { onStatus: (s: AuthStatus) => void; standing: string | null }) {
  const { t } = useI18n();
  const s = useSignInStyles();
  const ls = useLocalStyles();
  const [code, setCode] = useState(standing ?? "");
  const [username, setUsername] = useState("admin");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [timezone, setTimezone] = useState(browserTimeZone);
  const [contactEmail, setContactEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const body = { code: code.trim(), username: username.trim().toLowerCase(), password, fullName: fullName.trim(), companyName: companyName.trim(), timezone, contactEmail: contactEmail.trim() === "" ? null : contactEmail.trim() };
  const mismatch = confirm.length > 0 && confirm !== password;
  const checked = checkSetup(body);
  const problems = submitted ? [...(checked.ok ? [] : checked.errors), ...(confirm !== password ? [t("common.signIn.passwordsDifferError")] : [])] : [];
  const submit = async () => {
    // The contract's own check first: the page says every problem at once, before anything is sent.
    setSubmitted(true);
    if (!checked.ok || confirm !== password) return;
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
      aria-label={t("common.signIn.setupAria")}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Field
        label={standing !== null ? t("common.signIn.setupCodeStanding") : t("common.signIn.setupCodeOneTime")}
        required
        hint={standing !== null ? t("common.signIn.setupCodeStandingHint") : t("common.signIn.setupCodeOneTimeHint")}
      >
        <Input value={code} autoComplete="one-time-code" spellCheck={false} onChange={(_, d) => setCode(d.value)} />
      </Field>
      <div className={ls.gridTwo}>
        <Field label={t("common.signIn.usernameLabel")} required hint={t("common.signIn.usernameHint")}>
          <Input value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} onChange={(_, d) => setUsername(d.value)} />
        </Field>
        <Field label={t("common.signIn.fullNameLabel")} required>
          <Input value={fullName} autoComplete="name" onChange={(_, d) => setFullName(d.value)} />
        </Field>
      </div>
      <div className={ls.gridTwo}>
        <Field label={t("common.signIn.companyNameLabel")} hint={t("common.signIn.optionalHint")}>
          <Input value={companyName} autoComplete="organization" onChange={(_, d) => setCompanyName(d.value)} />
        </Field>
        <Field label={t("common.signIn.contactEmailLabel")} hint={t("common.signIn.contactEmailHint")}>
          <Input type="email" value={contactEmail} autoComplete="email" onChange={(_, d) => setContactEmail(d.value)} />
        </Field>
      </div>
      <Field label={t("common.signIn.timezoneLabel")} required hint={t("common.signIn.timezoneHint")}>
        <TimeZoneSelect value={timezone} onChange={setTimezone} />
      </Field>
      <PasswordInput label={t("common.signIn.passwordLabel")} value={password} onChange={setPassword} autoComplete="new-password" />
      <PasswordRules password={password} username={username.trim().toLowerCase()} />
      <PasswordInput
        label={t("common.signIn.repeatPasswordLabel")}
        value={confirm}
        onChange={setConfirm}
        autoComplete="new-password"
        validationState={mismatch ? "error" : "none"}
        validationMessage={mismatch ? t("common.signIn.passwordsDifferValidation") : undefined}
      />
      {problems.length > 0 && (
        <MessageBar intent="error" layout="multiline">
          <MessageBarBody>
            <ul aria-label={t("common.signIn.whatToCorrect")} style={{ margin: 0, paddingLeft: "18px" }}>
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
        <Spinner size="tiny" label={t("common.signIn.creatingAdmin")} />
      ) : (
        <Button className={s.wide} appearance="primary" size="large" type="submit">
          {t("common.signIn.createAdmin")}
        </Button>
      )}
    </form>
  );
}

export function SignInPage({ status, onStatus, onReload }: { status: AuthStatus; onStatus: (s: AuthStatus) => void; onReload: () => void }) {
  const { t } = useI18n();
  const s = useSignInStyles();
  const setup = status.state === "setup_required";
  return (
    <div className={`${s.root} orbit-touch`}>
      <TrialBar trial={status.trial} />
      <main className={s.page}>
        <div className={s.panel}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <h1 className={s.heading}>{setup ? t("common.signIn.setupTitle") : t("common.signIn.signInTitle")}</h1>
          <Text align="center" className={s.lead}>
            {setup ? t("common.signIn.setupLead") : t("common.signIn.signInLead")}
          </Text>
        </div>
        <section className={s.card} aria-label={setup ? t("common.signIn.setupAria") : t("common.signIn.signInTitle")}>
          {setup ? <SetupForm onStatus={onStatus} standing={status.setupCode ?? null} /> : <LoginForm onStatus={onStatus} onReload={onReload} />}
        </section>
        <Text size={200} className={s.foot}>
          {t("common.access.footer", { version: ORBIT_WEB_VERSION })}
        </Text>
      </main>
    </div>
  );
}
