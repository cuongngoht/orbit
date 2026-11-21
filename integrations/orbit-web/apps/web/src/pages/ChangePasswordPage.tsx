// A NEW PASSWORD FIRST: the user's password was set by somebody else (the trial seed, or an operator's reset), so the
// page asks for one of the user's own before anything of the account opens. The only other way on is to sign out.
import { Button, Text } from "@fluentui/react-components";
import { ORBIT_WEB_VERSION, type AuthStatus } from "@orbit-web/contracts";
import { ChangePasswordForm } from "../features/auth/ChangePasswordForm";
import { TrialBar } from "../features/auth/TrialBar";
import type { SignOut } from "../features/auth/useSignOut";
import { useSignInStyles } from "./signInStyles";

export function ChangePasswordPage({ status, onChanged, signOut }: { status: AuthStatus; onChanged: (s: AuthStatus) => void; signOut: SignOut }) {
  const s = useSignInStyles();
  const name = status.user?.fullName || status.user?.username || "you";
  return (
    <div className={`${s.root} orbit-touch`}>
      <TrialBar trial={status.trial} />
      <main className={s.page}>
        <div className={s.panel}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <h1 className={s.heading}>Choose a new password</h1>
          <Text align="center" className={s.lead}>
            Welcome, {name}. Your password was set for you, so it must be changed before Orbit opens.
          </Text>
        </div>
        <section className={s.card} aria-label="Choose a new password">
          <ChangePasswordForm username={status.user?.username ?? null} onChanged={onChanged} submitLabel="Change password and continue" />
          <div style={{ marginTop: "12px" }}>
            <Button appearance="subtle" disabled={signOut.busy} onClick={() => void signOut.signOut()}>
              Sign out
            </Button>
          </div>
          {signOut.error && (
            <Text size={200} className={s.hint}>
              {signOut.error}
            </Text>
          )}
        </section>
        <Text size={200} className={s.foot}>
          Orbit Web {ORBIT_WEB_VERSION}
        </Text>
      </main>
    </div>
  );
}
