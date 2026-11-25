// SHARE, in an open chat's header: first, the other Claude accounts that may open the chat itself (PeopleAccess); then
// a read-only link to a snapshot of the conversation (modules/share on the API). It says plainly who can read it and what
// they see; what the tools did comes along only when asked (it may hold the repository's code); the copy is updated to
// now on request -- the same link -- and sharing stops at once. The link carries its token in the fragment
// (`#/share/<token>`), so no server or Referer ever sees it. Only the chat's owner makes, updates or stops a link.
import {
  Button,
  Checkbox,
  Divider,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Open16Regular, Share20Regular } from "@fluentui/react-icons";
import type { AccessLevel, ShareInfo, ShareState } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { PeopleAccess } from "./PeopleAccess";

const useStyles = makeStyles({
  surface: { width: "min(520px, 94vw)", maxWidth: "min(520px, 94vw)" },
  body: { display: "flex", flexDirection: "column", gap: "12px" },
  row: { display: "flex", gap: "8px", alignItems: "flex-end", flexWrap: "wrap" },
  actions: { flexWrap: "wrap", gap: "8px" },
  compactBtn: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
});

export const shareLinkOf = (token: string): string => `${window.location.origin}/#/share/${token}`;

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function SharedLink({ share }: { share: ShareInfo }) {
  const { t } = useI18n();
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const link = shareLinkOf(share.token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <div className={s.row}>
        <Field label={t("chat.share.link.label")} style={{ flexGrow: 1 }}>
          <Input readOnly value={link} onFocus={(e) => e.target.select()} />
        </Field>
        <Button onClick={() => void copy()}>{copied ? t("chat.share.link.copied") : t("chat.share.link.copyLink")}</Button>
        <Button icon={<Open16Regular />} as="a" href={link} target="_blank" rel="noopener noreferrer">
          {t("chat.share.openLink")}
        </Button>
      </div>
      <Text size={200} className={s.muted}>
        {t("chat.share.link.meta", {
          at: when(share.updatedAt),
          count: share.entries,
          word: t(share.entries === 1 ? "chat.share.link.entryOne" : "chat.share.link.entryMany"),
          tools: t(share.includeTools ? "chat.share.link.withTools" : "chat.share.link.titlesOnly"),
        })}
      </Text>
    </>
  );
}

function ShareBody({ sessionId, access, onBusy }: { sessionId: string; access: AccessLevel; onBusy: (busy: boolean) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const state = useResource<ShareState>(() => get(`/api/sessions/${sessionId}/share`), [sessionId]);
  // The person's choice once made; until then, how the chat is shared now.
  const [choice, setChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const share = state.data?.share ?? null;
  const includeTools = choice ?? share?.includeTools ?? false;
  const { set } = state;

  const act = async (work: () => Promise<ShareState>) => {
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      set(await work());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  const create = () => act(async () => ({ share: await send<ShareInfo>("POST", `/api/sessions/${sessionId}/share`, { includeTools }) }));
  const stop = () =>
    act(async () => {
      await send("DELETE", `/api/sessions/${sessionId}/share`);
      return { share: null };
    });

  if (state.data === null)
    return state.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{state.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner size="tiny" label={t("chat.share.reading")} />
    );
  const pendingToolsChange = share !== null && choice !== null && choice !== share.includeTools;
  return (
    <div className={s.body}>
      <PeopleAccess path={`/api/sessions/${sessionId}/access`} what={t("chat.share.whatChat")} />
      <Divider />
      <Text weight="semibold">{t("chat.share.publicLink")}</Text>
      <Text>{t("chat.share.publicDesc")}</Text>
      {access === "owner" ? (
        <>
          <Checkbox checked={includeTools} onChange={(_, d) => setChoice(d.checked === true)} label={t("chat.share.includeTools")} />
          {pendingToolsChange && (
            <Text size={200} className={s.muted}>
              {t("chat.share.pendingUpdate")}
            </Text>
          )}
        </>
      ) : (
        <Text size={200} className={s.muted}>
          {t("chat.share.ownerOnlyLink")}
        </Text>
      )}
      {share !== null && <SharedLink share={share} />}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <DialogActions className={s.actions}>
        {access !== "owner" ? null : share === null ? (
          <Button appearance="primary" icon={busy ? <Spinner size="extra-tiny" /> : undefined} disabled={busy} onClick={() => void create()}>
            {t("chat.share.createLink")}
          </Button>
        ) : (
          <>
            <Button appearance="primary" icon={busy ? <Spinner size="extra-tiny" /> : undefined} disabled={busy} onClick={() => void create()}>
              {t("chat.share.updateToNow")}
            </Button>
            <Button style={{ color: tokens.colorPaletteRedForeground1 }} disabled={busy} onClick={() => void stop()}>
              {t("chat.share.stopSharing")}
            </Button>
          </>
        )}
        <DialogTrigger disableButtonEnhancement>
          <Button appearance="subtle">{t("chat.push.close")}</Button>
        </DialogTrigger>
      </DialogActions>
    </div>
  );
}

export function ShareButton({ sessionId, compact = false, access = "owner" }: { sessionId: string; compact?: boolean; access?: AccessLevel }) {
  const { t } = useI18n();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !busy && setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        {compact ? (
          <Button className={s.compactBtn} size="small" appearance="subtle" icon={<Share20Regular />} aria-label={t("chat.share.shareBtn")} />
        ) : (
          <Button size="small" appearance="subtle" icon={<Share20Regular />}>
            {t("chat.share.shareBtn")}
          </Button>
        )}
      </DialogTrigger>
      <DialogSurface className={`${s.surface} orbit-touch`}>
        <DialogBody>
          <DialogTitle>{t("chat.share.dialogTitle")}</DialogTitle>
          <DialogContent>{open && <ShareBody sessionId={sessionId} access={access} onBusy={setBusy} />}</DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
