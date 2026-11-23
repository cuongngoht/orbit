// WHO ELSE MAY OPEN IT: the other Claude accounts, by email, a chat or a research workspace is shared with. Its owner
// adds and removes them (each change is the whole list, saved at once); an account it was shared with sees who owns it
// and who else may open it, and changes nothing. An account sees nothing it was not shared.
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Dismiss16Regular, People20Regular } from "@fluentui/react-icons";
import { normalizeEmail, SHARE_PEOPLE_LIMIT, type AccessList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  head: { display: "flex", alignItems: "center", gap: "8px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  list: { listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0, display: "flex", flexDirection: "column", gap: "4px" },
  person: { display: "flex", alignItems: "center", gap: "8px", minHeight: "32px", "@media (pointer: coarse)": { minHeight: "44px" } },
  email: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// `path`: the access route of what is shared (`/api/sessions/:id/access`, `/api/research/workspaces/:id/access`);
// `what`: how it is called to a person.
export function PeopleAccess({ path, what }: { path: string; what: string }) {
  const { t } = useI18n();
  const s = useStyles();
  const state = useResource<AccessList>(() => get(path), [path]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { set } = state;
  const list = state.data;

  const save = async (people: string[]) => {
    setBusy(true);
    setError(null);
    try {
      set(await send<AccessList>("PUT", path, { people }));
      setDraft("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const add = () => {
    const asked = draft.split(/[\s,;]+/).filter((p) => p.length > 0);
    const emails = asked.map(normalizeEmail);
    if (emails.some((e) => e === null)) return setError(t("chat.share.people.emailError"));
    void save([...new Set([...(list?.people.map((p) => p.email) ?? []), ...(emails as string[])])]);
  };

  if (list === null) return state.error ? <Text>{state.error}</Text> : <Spinner size="tiny" label={t("chat.share.people.reading")} />;
  const owner = list.access === "owner";
  return (
    <section className={s.root} aria-label={t("chat.share.people.title")}>
      <div className={s.head}>
        <People20Regular />
        <Text weight="semibold">{t("chat.share.people.title")}</Text>
      </div>
      <Text size={200} className={s.muted}>
        {owner
          ? t("chat.share.people.ownerDesc", { what })
          : t("chat.share.people.sharedDesc", { owner: list.owner ?? t("chat.share.people.itsOwner") })}
      </Text>
      {owner && (
        <div className={s.row}>
          <Field label={t("chat.share.people.emailLabel")} style={{ flexGrow: 1 }}>
            <Input value={draft} type="email" disabled={busy} onChange={(_, d) => setDraft(d.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={t("chat.share.people.emailPlaceholder")} />
          </Field>
          <Button disabled={busy || draft.trim() === "" || list.people.length >= SHARE_PEOPLE_LIMIT} onClick={add}>
            {t("chat.share.people.shareBtn")}
          </Button>
        </div>
      )}
      {list.people.length === 0 ? (
        <Text size={200} className={s.muted}>
          {owner ? t("chat.share.people.noneOwner") : t("chat.share.people.noneGuest")}
        </Text>
      ) : (
        <ul className={s.list}>
          {list.people.map((p) => (
            <li key={p.email} className={s.person}>
              <span className={s.email}>{p.email}</span>
              {owner && <Button appearance="subtle" size="small" icon={<Dismiss16Regular />} aria-label={t("chat.share.people.stopSharingAria", { email: p.email })} disabled={busy} onClick={() => void save(list.people.map((x) => x.email).filter((x) => x !== p.email))} />}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  );
}
