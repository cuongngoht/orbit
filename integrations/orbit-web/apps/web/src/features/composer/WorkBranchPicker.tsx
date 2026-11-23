// THE WORKING BRANCH of an open chat, in the composer's toolbar: the branch its workspace has checked out (and the one
// the chat compares against). Open, it lists the chat's own branches and its repository's -- read only while it is
// open -- and moves the chat to the one chosen, or to a new branch made from the work as it is. The repository's
// default branch is listed and never offered; while Claude works, or the workspace is not ready, nothing moves. What the
// workspace refuses (uncommitted work, a branch that exists) is said here, in the workspace's own words.
import { Button, Input, MessageBar, MessageBarBody, Popover, PopoverSurface, PopoverTrigger, SearchBox, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { BranchFork16Regular, Checkmark16Regular, ChevronDown12Regular } from "@fluentui/react-icons";
import { isBranchName, type SessionSummary, type WorkBranch, type WorkBranches } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { t as tr, useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";

const useStyles = makeStyles({
  trigger: {
    minWidth: "unset",
    minHeight: "30px",
    maxWidth: "220px",
    flexShrink: 0,
    borderRadius: "9999px",
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground2,
    transitionProperty: "background-color, color",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  triggerMobile: {
    maxWidth: "180px",
    minHeight: "34px",
    borderRadius: "9999px",
    paddingTop: "0",
    paddingRight: "10px",
    paddingBottom: "0",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", "transparent"),
  },
  label: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  surface: { width: "380px", maxWidth: "90vw", padding: "8px", display: "flex", flexDirection: "column", gap: "8px" },
  sheetInner: { display: "flex", flexDirection: "column", gap: "10px" },
  list: { maxHeight: "260px", overflowY: "auto", display: "flex", flexDirection: "column", margin: 0, padding: 0, listStyleType: "none" },
  option: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    paddingTop: "6px",
    paddingRight: "8px",
    paddingBottom: "6px",
    paddingLeft: "8px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":disabled": { cursor: "default", color: tokens.colorNeutralForeground4, backgroundColor: "transparent" },
    "@media (pointer: coarse)": { minHeight: "46px", paddingTop: "8px", paddingBottom: "8px" },
  },
  optionMobile: { minHeight: "46px", paddingTop: "8px", paddingBottom: "8px" },
  selected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  text: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
  name: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  muted: { color: tokens.colorNeutralForeground3 },
  create: { display: "flex", gap: "6px", alignItems: "center", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: "8px" },
  createBtnMobile: { minHeight: "40px" },
});

const MAX_SHOWN = 200;

// What a branch is, beside its name: the default one (never worked on), one only this workspace has, one to fetch.
function noteOf(b: WorkBranch): string | null {
  if (b.isDefault) return tr("chat.workBranch.note.default");
  if (b.local && !b.remote) return tr("chat.workBranch.note.localOnly");
  if (!b.local) return tr("chat.workBranch.note.remoteOnly");
  return null;
}

export function WorkBranchPicker(p: { sessionId: string; base: string | null; work: string; disabled: boolean; onMoved: (s: SessionSummary) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useResource<WorkBranches>(open ? () => get(`/api/sessions/${p.sessionId}/branches`) : null, [open, p.sessionId, p.work]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list.data?.branches ?? []).filter((b) => q === "" || b.name.toLowerCase().includes(q)).slice(0, MAX_SHOWN);
  }, [list.data, query]);
  const current = list.data?.current ?? p.work;

  const move = async (branch: string, create: boolean) => {
    setBusy(branch);
    setError(null);
    try {
      const summary = await send<SessionSummary>("POST", `/api/sessions/${p.sessionId}/branch`, create ? { branch, create: true } : { branch });
      p.onMoved(summary);
      setName("");
      setOpen(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const body = (
    <>
      <Text size={200} className={s.muted}>
        {t("chat.workBranch.commitsNote", { against: p.base ? t("chat.workBranch.againstBase", { base: p.base }) : "" })}
      </Text>
      <SearchBox size={isMobile ? "medium" : "small"} placeholder={t("chat.workBranch.searchPlaceholder")} aria-label={t("chat.workBranch.searchAria")} value={query} onChange={(_, d) => setQuery(d.value)} />
      {list.loading && list.data === null && <Spinner size="tiny" label={t("chat.repoPicker.readingBranches")} />}
      {list.error && (
        <MessageBar intent="error">
          <MessageBarBody>{list.error}</MessageBarBody>
        </MessageBar>
      )}
      {list.data?.remoteError && (
        <Text size={200} className={s.muted}>
          {t("chat.workBranch.remoteError", { error: list.data.remoteError })}
        </Text>
      )}
      <ul className={s.list} role="listbox" aria-label={t("chat.workBranch.branchesAria")}>
        {shown.map((b) => {
          const isCurrent = b.name === current;
          const note = noteOf(b);
          return (
            <li key={b.name} role="option" aria-selected={isCurrent} aria-label={b.name}>
              <button type="button" className={mergeClasses(s.option, isMobile && s.optionMobile, isCurrent && s.selected)} disabled={b.isDefault || isCurrent || busy !== null} onClick={() => void move(b.name, false)}>
                <span className={s.text}>
                  <span className={s.name}>{b.name}</span>
                  {note && (
                    <Text size={100} className={s.muted}>
                      {note}
                    </Text>
                  )}
                </span>
                {busy === b.name && <Spinner size="extra-tiny" />}
                {isCurrent && <Checkmark16Regular />}
              </button>
            </li>
          );
        })}
        {list.data !== null && shown.length === 0 && (
          <li>
            <Text size={200} className={s.muted}>
              {t("chat.workBranch.noMatch")}
            </Text>
          </li>
        )}
      </ul>
      <form
        className={s.create}
        onSubmit={(e) => {
          e.preventDefault();
          if (isBranchName(name.trim())) void move(name.trim(), true);
        }}
      >
        <Input size={isMobile ? "medium" : "small"} style={{ flexGrow: 1 }} placeholder={t("chat.workBranch.newBranchPlaceholder")} aria-label={t("chat.workBranch.newBranchAria")} value={name} onChange={(_, d) => setName(d.value)} />
        <Button className={isMobile ? s.createBtnMobile : undefined} size={isMobile ? "medium" : "small"} appearance="primary" type="submit" disabled={!isBranchName(name.trim()) || busy !== null}>
          {t("chat.workBranch.create")}
        </Button>
      </form>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </>
  );

  const trigger = (
    <Button
      className={mergeClasses(s.trigger, isMobile && s.triggerMobile)}
      appearance="subtle"
      size="small"
      icon={<BranchFork16Regular />}
      disabled={p.disabled}
      aria-label={t("chat.workBranch.triggerAria", { branch: p.work })}
      title={p.disabled ? t("chat.workBranch.disabledTitle") : t("chat.workBranch.enabledTitle")}
      onClick={
        isMobile
          ? () => {
              setError(null);
              setOpen(true);
            }
          : undefined
      }
    >
      <span className={s.label}>{p.base && !isMobile ? `${p.base} → ${p.work}` : p.work}</span>
      <ChevronDown12Regular />
    </Button>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <ResponsiveSheet
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            setError(null);
          }}
          title={t("chat.workBranch.sheetTitle")}
          ariaLabel={t("chat.workBranch.enabledTitle")}
        >
          <div className={s.sheetInner}>{body}</div>
        </ResponsiveSheet>
      </>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(_, d) => {
        setOpen(d.open);
        setError(null);
      }}
      positioning="above-start"
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>{trigger}</PopoverTrigger>
      <PopoverSurface className={s.surface} aria-label={t("chat.workBranch.enabledTitle")}>
        {body}
      </PopoverSurface>
    </Popover>
  );
}
