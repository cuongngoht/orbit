// SETTINGS → ACCOUNT: the person signed in to Orbit and the Orbit account they belong to. Four things, each saved on its
// own: the user's profile (full name, email -- unverified until Orbit can send mail), the account (company, time zone,
// locale, contact email: changed against the version read, so two pages never overwrite each other), the password, and
// the sessions of this user, any of which can be ended -- or all of them at once.
import { Avatar, Badge, Button, Field, Input, MessageBar, MessageBarActions, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Dismiss16Regular, SignOut20Regular } from "@fluentui/react-icons";
import { checkUpdateAccountProfile, checkUpdateProfile, type AuthAccount, type AuthStatus, type AuthUser, type SessionView, type UpdateAccountProfileRequest } from "@orbit-web/contracts";
import { useState } from "react";
import { TimeZoneSelect } from "../../components/TimeZoneSelect";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { ChangePasswordForm } from "../auth/ChangePasswordForm";
import type { SignOut } from "../auth/useSignOut";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "18px", minWidth: 0 },
  who: { display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap", padding: "14px 16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1, minWidth: 0 },
  identity: { display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  block: { display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, minWidth: 0 },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", alignItems: "start", "@media (max-width: 639px)": { gridTemplateColumns: "1fr" } },
  labelRow: { display: "inline-flex", alignItems: "center", gap: "6px" },
  sessions: { display: "flex", flexDirection: "column", gap: "6px", margin: 0, padding: 0, listStyleType: "none" },
  session: { display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke2}`, minWidth: 0 },
  sessionText: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap", "@media (max-width: 639px)": { flexDirection: "column" } },
  button: { alignSelf: "flex-start", "@media (max-width: 639px), (pointer: coarse)": { alignSelf: "stretch", minHeight: "44px" } },
  hint: { color: tokens.colorNeutralForeground3 },
});

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "—");

function friendlyUa(ua: string | null): string | null {
  if (!ua || !ua.startsWith("Mozilla/")) return ua;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? ua;
}

function Profile({ user, onSaved }: { user: AuthUser; onSaved: (u: AuthUser) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const change = { ...(fullName.trim() !== user.fullName ? { fullName: fullName.trim() } : {}), ...(email.trim() !== (user.email ?? "") ? { email: email.trim() === "" ? null : email.trim() } : {}) };
  const changed = Object.keys(change).length > 0;
  const save = async () => {
    const checked = checkUpdateProfile(change);
    if (!checked.ok) return setError(checked.errors.join("; "));
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await send<AuthUser>("PATCH", "/api/auth/profile", checked.value));
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.block}
      aria-label={t("settings.account.profile.title")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Text weight="semibold">{t("settings.account.profile.title")}</Text>
      <div className={s.grid}>
        <Field label={t("settings.account.profile.fullName")} required>
          <Input value={fullName} autoComplete="name" onChange={(_, d) => setFullName(d.value)} />
        </Field>
        <Field
          label={
            <span className={s.labelRow}>
              {t("settings.account.profile.email")}
              {user.email !== null && !user.emailVerified && (
                <Badge appearance="tint" color="warning" size="small">
                  {t("settings.account.profile.unverified")}
                </Badge>
              )}
            </span>
          }
          hint={t("settings.account.profile.emailHint")}
        >
          <Input type="email" value={email} autoComplete="email" onChange={(_, d) => setEmail(d.value)} />
        </Field>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {saved && !changed && (
        <Text size={200} className={s.hint}>
          {t("settings.account.profile.saved")}
        </Text>
      )}
      <Button className={s.button} type="submit" disabled={busy || !changed}>
        {busy ? t("settings.account.profile.saving") : t("settings.account.profile.save")}
      </Button>
    </form>
  );
}

const FIELDS = ["companyName", "displayName", "contactEmail", "timezone", "locale"] as const;

function AccountForm({ account, onSaved }: { account: AuthAccount; onSaved: (a: AuthAccount) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [draft, setDraft] = useState({ companyName: account.companyName, displayName: account.displayName, contactEmail: account.contactEmail ?? "", timezone: account.timezone, locale: account.locale });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const original = { companyName: account.companyName, displayName: account.displayName, contactEmail: account.contactEmail ?? "", timezone: account.timezone, locale: account.locale };
  const change: UpdateAccountProfileRequest = {};
  for (const f of FIELDS) if (draft[f].trim() !== original[f]) Object.assign(change, { [f]: f === "contactEmail" && draft[f].trim() === "" ? null : draft[f].trim() });
  const changed = Object.keys(change).length > 0;
  const set = (f: (typeof FIELDS)[number]) => (_: unknown, d: { value: string }) => setDraft((x) => ({ ...x, [f]: d.value }));
  const save = async () => {
    const checked = checkUpdateAccountProfile(change);
    if (!checked.ok) return setError(checked.errors.join("; "));
    setBusy(true);
    setError(null);
    setStale(false);
    setSaved(false);
    try {
      onSaved(await send<AuthAccount>("PATCH", "/api/account", checked.value, ifMatch(account.version)));
      setSaved(true);
    } catch (err) {
      setStale(isStale(err));
      setError(isStale(err) ? t("settings.account.form.stale") : errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const loadLatest = async () => {
    setBusy(true);
    try {
      onSaved(await get<AuthAccount>("/api/account"));
      setError(null);
      setStale(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.block}
      aria-label={t("settings.account.form.title")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Text weight="semibold">{t("settings.account.form.title")}</Text>
      <Text size={200} className={s.hint}>
        {t("settings.account.form.hint")}
      </Text>
      <div className={s.grid}>
        <Field label={t("settings.account.form.companyName")}>
          <Input value={draft.companyName} autoComplete="organization" onChange={set("companyName")} />
        </Field>
        <Field label={t("settings.account.form.displayName")} hint={t("settings.account.form.displayNameHint")}>
          <Input value={draft.displayName} onChange={set("displayName")} />
        </Field>
        <Field label={t("settings.account.form.contactEmail")} hint={t("settings.account.form.contactEmailHint")}>
          <Input type="email" value={draft.contactEmail} onChange={set("contactEmail")} />
        </Field>
        <Field label={t("settings.account.form.timezone")}>
          <TimeZoneSelect value={draft.timezone} onChange={(z) => setDraft((x) => ({ ...x, timezone: z }))} />
        </Field>
        <Field label={t("settings.account.form.locale")} hint={t("settings.account.form.localeHint")}>
          <Input list="orbit-locale-options" value={draft.locale} onChange={set("locale")} />
          <datalist id="orbit-locale-options">
            <option value="en" />
            <option value="en-US" />
            <option value="en-GB" />
          </datalist>
        </Field>
      </div>
      {error && (
        <MessageBar intent={stale ? "warning" : "error"}>
          <MessageBarBody>{error}</MessageBarBody>
          {stale && (
            <MessageBarActions>
              <Button size="small" onClick={() => void loadLatest()}>
                {t("settings.connections.loadLatest")}
              </Button>
            </MessageBarActions>
          )}
        </MessageBar>
      )}
      {saved && !changed && (
        <Text size={200} className={s.hint}>
          {t("settings.account.profile.saved")}
        </Text>
      )}
      <Button className={s.button} type="submit" disabled={busy || !changed}>
        {busy ? t("settings.account.profile.saving") : t("settings.account.form.save")}
      </Button>
    </form>
  );
}

function Sessions({ signOut }: { signOut: SignOut }) {
  const { t } = useI18n();
  const s = useStyles();
  const list = useResource<SessionView[]>(() => get("/api/auth/sessions"), []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const revoke = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await send<void>("DELETE", `/api/auth/sessions/${encodeURIComponent(id)}`);
      await list.reload();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className={s.block} aria-label={t("settings.account.sessions.title")}>
      <Text weight="semibold">{t("settings.account.sessions.title")}</Text>
      {list.data === null ? (
        list.error ? (
          <Text className={s.hint}>{list.error}</Text>
        ) : (
          <Spinner size="tiny" label={t("settings.account.sessions.loading")} />
        )
      ) : (
        <ul className={s.sessions} aria-label={t("settings.account.sessions.listAria")}>
          {list.data.map((b) => {
            const label = friendlyUa(b.userAgent) ?? t("settings.account.sessions.aBrowser");
            return (
              <li key={b.id} className={s.session}>
                <div className={s.sessionText}>
                  <Text className={s.ellipsis} title={b.userAgent ?? undefined}>
                    {b.current ? t("settings.account.sessions.thisBrowser") : label}
                  </Text>
                  <Text size={200} className={s.hint}>
                    {t("settings.account.sessions.meta", { created: when(b.createdAt), lastSeen: when(b.lastSeenAt), expires: when(b.expiresAt) })}
                  </Text>
                </div>
                {!b.current && (
                  <Button appearance="subtle" size="small" icon={<Dismiss16Regular />} disabled={busy !== null} onClick={() => void revoke(b.id)} aria-label={t("settings.account.sessions.signOutAria", { browser: label })}>
                    {t("settings.account.sessions.signOut")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(error ?? signOut.error) && (
        <MessageBar intent="error">
          <MessageBarBody>{error ?? signOut.error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button className={s.button} appearance="secondary" icon={<SignOut20Regular />} disabled={signOut.busy} onClick={() => void signOut.signOut()}>
          {t("settings.account.sessions.signOutThis")}
        </Button>
        <Button className={s.button} appearance="subtle" disabled={signOut.busy} onClick={() => void signOut.signOutEverywhere()}>
          {t("settings.account.sessions.signOutEverywhere")}
        </Button>
      </div>
      <Text size={200} className={s.hint}>
        {t("settings.account.sessions.hint")}
      </Text>
    </section>
  );
}

export function AccountSection({ auth, onAuth, signOut }: { auth: AuthStatus & { user: AuthUser }; onAuth: (s: AuthStatus) => void; signOut: SignOut }) {
  const { t } = useI18n();
  const s = useStyles();
  const user = auth.user;
  const account = auth.account;
  return (
    <div className={`${s.root} orbit-touch`}>
      <div className={s.who}>
        <Avatar name={user.fullName || user.username} size={40} />
        <div className={s.identity}>
          <Text weight="semibold" className={s.ellipsis}>
            {user.fullName || user.username}
          </Text>
          <Text size={200} className={s.hint}>
            @{user.username} · {user.role === "owner" ? t("settings.account.ownerRole") : user.role}
            {account?.companyName ? ` · ${account.companyName}` : ""}
            {user.lastLoginAt ? t("settings.account.lastSignedIn", { when: when(user.lastLoginAt) }) : ""}
          </Text>
        </div>
      </div>
      <Profile key={`${user.fullName}|${user.email ?? ""}`} user={user} onSaved={(u) => onAuth({ ...auth, user: u })} />
      {account && <AccountForm key={`${account.version}`} account={account} onSaved={(a) => onAuth({ ...auth, account: a })} />}
      <section className={s.block} aria-label={t("settings.account.password")}>
        <Text weight="semibold">{t("settings.account.password")}</Text>
        <ChangePasswordForm username={user.username} onChanged={onAuth} />
      </section>
      <Sessions signOut={signOut} />
    </div>
  );
}
