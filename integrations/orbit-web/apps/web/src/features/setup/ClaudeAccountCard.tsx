// Settings: the Claude account Orbit Web is signed in with -- its sign-in -- and Sign out, which signs Orbit Web out.
import { Button, Card, CardHeader, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ClaudeStatus } from "@orbit-web/contracts";
import { ConnectionBadge } from "../../components/StatusBadge";
import { accountLine } from "../auth/AccountMenu";
import type { SignOut } from "../auth/useSignOut";

const useStyles = makeStyles({
  body: { display: "flex", flexDirection: "column", gap: "10px" },
  hint: { color: tokens.colorNeutralForeground3 },
});

export function ClaudeAccountCard({ status, signOut }: { status: ClaudeStatus | null; signOut: SignOut }) {
  const s = useStyles();
  const line = accountLine(status?.account ?? null);
  return (
    <Card aria-label="Claude Account">
      <CardHeader header={<Text weight="semibold">Claude Account</Text>} description={status ? <ConnectionBadge state={status.state} /> : <Spinner size="tiny" />} />
      <div className={s.body}>
        <Text>
          Signed in as <strong>{status?.account?.email ?? "a Claude account"}</strong>
        </Text>
        {line && (
          <Text size={200} className={s.hint}>
            {line}
          </Text>
        )}
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
          <Button appearance="secondary" disabled={signOut.busy} onClick={() => void signOut.signOut()}>
            Sign out
          </Button>
        </div>
        <Text size={200} className={s.hint}>
          This is Orbit Web's sign-in: signing out closes Orbit Web until you sign in again. Your chats are kept.
        </Text>
      </div>
    </Card>
  );
}
