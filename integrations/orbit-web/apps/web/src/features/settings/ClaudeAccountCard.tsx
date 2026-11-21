// SETTINGS → ACCOUNT: the account this browser is signed in to -- Orbit Web's own record of your Claude identity: its
// name (a business name, yours to set or leave empty), the Claude account it is (address, organization, plan), the
// browsers signed in to it -- and the two ways out: this browser, or the whole account (every browser, and the Claude
// CLI). There is no password and nothing to register: the Claude sign-in is the sign-in.
import { Avatar, Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Dismiss16Regular, SignOut20Regular } from "@fluentui/react-icons";
import type { AccountView, ClaudeStatus } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ConnectionBadge } from "../../components/StatusBadge";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { accountLine } from "../auth/account";
import type { SignOut } from "../auth/useSignOut";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },
  who: { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", padding: "14px 16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  identity: { display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0 },
  email: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap", "@media (max-width: 639px)": { flexDirection: "column", alignItems: "stretch" } },
  grow: { flexGrow: 1, minWidth: 0 },
  sessions: { display: "flex", flexDirection: "column", gap: "6px", margin: 0, padding: 0, listStyleType: "none" },
  session: { display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke2}` },
  sessionText: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", "@media (max-width: 639px)": { flexDirection: "column" } },
  button: { "@media (max-width: 639px)": { width: "100%", minHeight: "44px" } },
  hint: { color: tokens.colorNeutralForeground3 },
});

const when = (iso: string): string => new Date(iso).toLocaleString();

export function ClaudeAccountCard({ status, signOut }: { status: ClaudeStatus | null; signOut: SignOut }) {
  const s = useStyles();
  const account = useResource<AccountView>(() => get("/api/account"), []);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(account.data?.displayName ?? ""), [account.data?.displayName]);
  const email = account.data?.email ?? status?.account?.email ?? "a Claude account";
  const line = accountLine(status?.account ?? null);

  const act = async (work: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    try {
      await work();
      await account.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={s.root} aria-label="Account">
      <div className={s.who}>
        <Avatar name={account.data?.displayName || email} size={40} />
        <div className={s.identity}>
          <Text weight="semibold" className={s.email}>
            {account.data?.displayName || email}
          </Text>
          <Text size={200} className={s.hint}>
            {[account.data?.displayName ? email : null, line].filter((x) => x !== null).join(" · ")}
          </Text>
        </div>
        {status ? <ConnectionBadge state={status.state} /> : <Spinner size="tiny" />}
      </div>

      <form
        className={s.row}
        onSubmit={(e) => {
          e.preventDefault();
          void act(() => send("PUT", "/api/account", { displayName: name }));
        }}
      >
        <Field className={s.grow} label="Business name" hint="Shown for this account. Optional: change it whenever you like.">
          <Input value={name} maxLength={120} onChange={(_, d) => setName(d.value)} placeholder="Your company or team" />
        </Field>
        <Button className={s.button} type="submit" disabled={saving || account.data === null || name.trim() === (account.data?.displayName ?? "")}>
          Save
        </Button>
      </form>

      <div>
        <Text weight="semibold">Signed-in browsers</Text>
        {account.data === null ? (
          <Spinner size="tiny" />
        ) : (
          <ul className={s.sessions}>
            {account.data.sessions.map((b) => (
              <li key={b.id} className={s.session}>
                <div className={s.sessionText}>
                  <Text className={s.ellipsis}>{b.current ? "This browser" : (b.userAgent ?? "A browser")}</Text>
                  <Text size={200} className={s.hint}>
                    Signed in {when(b.createdAt)} · last seen {when(b.lastSeenAt)}
                  </Text>
                </div>
                {!b.current && (
                  <Button appearance="subtle" size="small" icon={<Dismiss16Regular />} disabled={saving} onClick={() => void act(() => send("DELETE", `/api/account/sessions/${b.id}`))}>
                    Sign out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {status?.detail && (
        <Text size={200} className={s.hint}>
          {status.detail}
        </Text>
      )}
      {(error ?? signOut.error) && (
        <MessageBar intent="error">
          <MessageBarBody>{error ?? signOut.error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button className={s.button} appearance="secondary" icon={<SignOut20Regular />} disabled={signOut.busy} onClick={() => void signOut.signOut()}>
          Sign out of this browser
        </Button>
        <Button className={s.button} appearance="subtle" disabled={signOut.busy} onClick={() => void signOut.signOutAccount()}>
          Sign the account out everywhere
        </Button>
      </div>
      <Text size={200} className={s.hint}>
        Your Claude account is your sign-in here. Signing the account out signs out every browser and the Claude CLI itself; your chats, research and governance records are kept.
      </Text>
    </section>
  );
}
