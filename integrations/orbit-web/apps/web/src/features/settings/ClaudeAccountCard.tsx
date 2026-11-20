// SETTINGS → ACCOUNT: the Claude account Orbit Web is signed in with -- its address, what the CLI said about it -- and
// Sign out, which signs Orbit Web out (the Claude sign-in is Orbit Web's sign-in).
import { Avatar, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { SignOut20Regular } from "@fluentui/react-icons";
import type { ClaudeStatus } from "@orbit-web/contracts";
import { ConnectionBadge } from "../../components/StatusBadge";
import { accountLine } from "../auth/account";
import type { SignOut } from "../auth/useSignOut";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },
  who: { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", padding: "14px 16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  identity: { display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0 },
  email: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  signOutBtn: { "@media (max-width: 639px)": { width: "100%", minHeight: "44px" } },
  hint: { color: tokens.colorNeutralForeground3 },
});

export function ClaudeAccountCard({ status, signOut }: { status: ClaudeStatus | null; signOut: SignOut }) {
  const s = useStyles();
  const email = status?.account?.email ?? "a Claude account";
  const line = accountLine(status?.account ?? null);
  return (
    <section className={s.root} aria-label="Claude Account">
      <div className={s.who}>
        <Avatar name={email} size={40} />
        <div className={s.identity}>
          <Text weight="semibold" className={s.email}>
            {email}
          </Text>
          {line && (
            <Text size={200} className={s.hint}>
              {line}
            </Text>
          )}
        </div>
        {status ? <ConnectionBadge state={status.state} /> : <Spinner size="tiny" />}
      </div>
      {status?.detail && (
        <Text size={200} className={s.hint}>
          {status.detail}
        </Text>
      )}
      {signOut.error && (
        <MessageBar intent="error">
          <MessageBarBody>{signOut.error}</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Button className={s.signOutBtn} appearance="secondary" icon={<SignOut20Regular />} disabled={signOut.busy} onClick={() => void signOut.signOut()}>
          Sign out
        </Button>
      </div>
      <Text size={200} className={s.hint}>
        This is Orbit Web's sign-in: signing out closes Orbit Web until you sign in again. Your chats are kept.
      </Text>
    </section>
  );
}
