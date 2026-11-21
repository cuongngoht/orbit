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
import { Share20Regular } from "@fluentui/react-icons";
import type { AccessLevel, ShareInfo, ShareState } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
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
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const link = shareLinkOf(share.token);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <div className={s.row}>
        <Field label="Link" style={{ flexGrow: 1 }}>
          <Input readOnly value={link} onFocus={(e) => e.target.select()} />
        </Field>
        <Button onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Button>
      </div>
      <Text size={200} className={s.muted}>
        Shared as it was {when(share.updatedAt)} · {share.entries} {share.entries === 1 ? "entry" : "entries"} · {share.includeTools ? "with what the tools did" : "tools by their title only"}.
      </Text>
    </>
  );
}

function ShareBody({ sessionId, access, onBusy }: { sessionId: string; access: AccessLevel; onBusy: (busy: boolean) => void }) {
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

  if (state.data === null) return state.error ? <Text>{state.error}</Text> : <Spinner size="tiny" label="Reading how this chat is shared…" />;
  return (
    <div className={s.body}>
      <PeopleAccess path={`/api/sessions/${sessionId}/access`} what="chat" />
      <Divider />
      <Text weight="semibold">Public link</Text>
      <Text>
        Anyone with the link can read this conversation as it is now — not what comes after, until you update it. They need no access token and no
        Claude account, and they see nothing else of Orbit Web: not the workspace, its files, nor your other chats. Secrets are masked by their shape.
      </Text>
      {access === "owner" ? (
        <Checkbox checked={includeTools} onChange={(_, d) => setChoice(d.checked === true)} label="Include what the tools did — the commands' and the files' contents (they may hold the repository's code)" />
      ) : (
        <Text size={200} className={s.muted}>
          Only the chat's owner makes, updates or stops its public link.
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
          <Button appearance="primary" disabled={busy} onClick={() => void create()}>
            Create link
          </Button>
        ) : (
          <>
            <Button appearance="primary" disabled={busy} onClick={() => void create()}>
              Update to now
            </Button>
            <Button disabled={busy} onClick={() => void stop()}>
              Stop sharing
            </Button>
          </>
        )}
        <DialogTrigger disableButtonEnhancement>
          <Button appearance="subtle">Close</Button>
        </DialogTrigger>
      </DialogActions>
    </div>
  );
}

export function ShareButton({ sessionId, compact = false, access = "owner" }: { sessionId: string; compact?: boolean; access?: AccessLevel }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(_, d) => !busy && setOpen(d.open)}>
      <DialogTrigger disableButtonEnhancement>
        {compact ? (
          <Button className={s.compactBtn} size="small" appearance="subtle" icon={<Share20Regular />} aria-label="Share" />
        ) : (
          <Button size="small" appearance="subtle" icon={<Share20Regular />}>
            Share
          </Button>
        )}
      </DialogTrigger>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>Share this chat</DialogTitle>
          <DialogContent>{open && <ShareBody sessionId={sessionId} access={access} onBusy={setBusy} />}</DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
