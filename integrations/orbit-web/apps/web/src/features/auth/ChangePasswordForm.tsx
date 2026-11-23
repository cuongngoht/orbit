// CHANGE THE PASSWORD: the current one, a new one held to the rules as it is typed, and the new one again. The API
// answers with the sign-in as it is afterwards (the session may rotate, and a trial seed's waiver ends here).
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, makeStyles } from "@fluentui/react-components";
import { checkChangePassword, type AuthStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { useI18n } from "../../i18n";
import { PasswordInput } from "../../pages/SignInPage";
import { errorText, send } from "../../services/api";
import { PasswordRules } from "./PasswordRules";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: "12px", textAlign: "left", minWidth: 0 },
  button: { alignSelf: "flex-start", "@media (max-width: 639px), (pointer: coarse)": { alignSelf: "stretch", minHeight: "44px" } },
});

export function ChangePasswordForm({ username, onChanged, submitLabel }: { username: string | null; onChanged: (status: AuthStatus) => void; submitLabel?: string }) {
  const { t } = useI18n();
  const s = useStyles();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mismatch = again.length > 0 && again !== next;
  const submit = async () => {
    const checked = checkChangePassword({ currentPassword: current, newPassword: next }, username);
    if (!checked.ok || again !== next) {
      setError([...(checked.ok ? [] : checked.errors), ...(again !== next ? [t("settings.auth.passwordsDiffer")] : [])].join("; "));
      return;
    }
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const status = await send<AuthStatus>("POST", "/api/auth/password", checked.value);
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
      onChanged(status);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.form}
      aria-label={t("settings.auth.changePassword")}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <PasswordInput label={t("settings.auth.currentPassword")} value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordInput label={t("settings.auth.newPassword")} value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordRules password={next} username={username} />
      <Field label={t("settings.auth.repeatNewPassword")} required validationState={mismatch ? "error" : "none"} validationMessage={mismatch ? t("settings.auth.passwordsDifferSentence") : undefined}>
        <Input type="password" value={again} autoComplete="new-password" onChange={(_, d) => setAgain(d.value)} />
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {done && (
        <MessageBar intent="success">
          <MessageBarBody>{t("settings.auth.passwordChanged")}</MessageBarBody>
        </MessageBar>
      )}
      {busy ? (
        <Spinner size="tiny" label={t("settings.auth.changingPassword")} />
      ) : (
        <Button className={s.button} appearance="primary" type="submit" disabled={current.length === 0 || next.length === 0 || again.length === 0}>
          {submitLabel ?? t("settings.auth.changePassword")}
        </Button>
      )}
    </form>
  );
}
