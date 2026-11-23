// A NEW PASSWORD FIRST: the user's password was set by somebody else (the trial seed, or an operator's reset), so the
// page asks for one of the user's own before anything of the account opens. The only other way on is to sign out.
import { Button, Text } from "@fluentui/react-components";
import { ORBIT_WEB_VERSION, type AuthStatus } from "@orbit-web/contracts";
import { ChangePasswordForm } from "../features/auth/ChangePasswordForm";
import { TrialBar } from "../features/auth/TrialBar";
import type { SignOut } from "../features/auth/useSignOut";
import { useI18n } from "../i18n";
import { useSignInStyles } from "./signInStyles";

export function ChangePasswordPage({ status, onChanged, signOut }: { status: AuthStatus; onChanged: (s: AuthStatus) => void; signOut: SignOut }) {
  const { t } = useI18n();
  const s = useSignInStyles();
  const name = status.user?.fullName || status.user?.username || t("common.changePassword.defaultName");
  return (
    <div className={`${s.root} orbit-touch`}>
      <TrialBar trial={status.trial} />
      <main className={s.page}>
        <div className={s.panel}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <h1 className={s.heading}>{t("common.changePassword.title")}</h1>
          <Text align="center" className={s.lead}>
            {t("common.changePassword.lead", { name })}
          </Text>
        </div>
        <section className={s.card} aria-label={t("common.changePassword.title")}>
          <ChangePasswordForm username={status.user?.username ?? null} onChanged={onChanged} submitLabel={t("common.changePassword.submit")} />
          <div style={{ marginTop: "12px" }}>
            <Button appearance="subtle" disabled={signOut.busy} onClick={() => void signOut.signOut()}>
              {t("common.changePassword.signOut")}
            </Button>
          </div>
          {signOut.error && (
            <Text size={200} className={s.hint}>
              {signOut.error}
            </Text>
          )}
        </section>
        <Text size={200} className={s.foot}>
          {t("common.access.footer", { version: ORBIT_WEB_VERSION })}
        </Text>
      </main>
    </div>
  );
}
