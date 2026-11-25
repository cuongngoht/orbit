// What changed in the workspace, read from git there: the files against the commit the chat started from, their
// line counts, and a file's diff on request.
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Text, ToggleButton, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular, ArrowLeft16Regular, ChevronRight16Regular, TextWrap16Regular } from "@fluentui/react-icons";
import type { ChangeKind, ChangesReport, FileDiff } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { errorText, get } from "../../services/api";
import { DiffView } from "./DiffView";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  meta: { color: tokens.colorNeutralForeground3, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "10px", rowGap: "2px" },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" },
  listBounded: { maxHeight: "240px", overflowY: "auto" },
  file: { display: "flex", alignItems: "center", gap: "8px", paddingTop: "4px", paddingRight: "6px", paddingBottom: "4px", paddingLeft: "6px", borderRadius: tokens.borderRadiusSmall, cursor: "pointer", ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  fileMobile: {
    minHeight: "48px",
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "10px",
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  chosen: { backgroundColor: tokens.colorNeutralBackground1Selected },
  path: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  add: { color: tokens.colorPaletteGreenForeground1 },
  del: { color: tokens.colorPaletteRedForeground1 },
  row: { display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between" },
  diffBar: { display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  filePill: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "6px",
    paddingRight: "10px",
    paddingBottom: "6px",
    paddingLeft: "10px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  touchBtn: { minWidth: "44px", minHeight: "44px" },
  backBtn: { minHeight: "44px", paddingLeft: "6px", paddingRight: "10px" },
  wrapBtn: { minHeight: "34px", "@media (pointer: coarse)": { minHeight: "40px" } },
});

const KIND: Record<ChangeKind, { label: string; color: "success" | "danger" | "informative" | "warning" | "subtle" }> = {
  added: { label: "A", color: "success" },
  untracked: { label: "U", color: "success" },
  modified: { label: "M", color: "informative" },
  deleted: { label: "D", color: "danger" },
  renamed: { label: "R", color: "warning" },
  copied: { label: "C", color: "warning" },
  type_changed: { label: "T", color: "warning" },
  conflicted: { label: "!", color: "danger" },
};

export function ChangesPanel({ sessionId, version }: { sessionId: string; version: number }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const report = useResource<ChangesReport>(() => get(`/api/sessions/${sessionId}/changes`), [sessionId]);
  const [path, setPath] = useState<string | null>(null);
  const [wrap, setWrap] = useState(false);
  const diffBarRef = useRef<HTMLDivElement>(null);
  // The diff that was read, and for which file and moment: shown only while it is the one asked for.
  const [read, setRead] = useState<{ key: string; diff: FileDiff | null; error: string | null } | null>(null);
  const key = `${path}@${version}`;
  const diff = read?.key === key ? read.diff : null;
  const diffError = read?.key === key ? read.error : null;

  useEffect(() => {
    void report.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read git again when the workspace may have changed
  }, [version]);

  useEffect(() => {
    if (path === null) return undefined;
    let current = true;
    get<FileDiff>(`/api/sessions/${sessionId}/changes/file?path=${encodeURIComponent(path)}`).then(
      (d) => current && setRead({ key: `${path}@${version}`, diff: d, error: null }),
      (err: unknown) => current && setRead({ key: `${path}@${version}`, diff: null, error: errorText(err) }),
    );
    return () => {
      current = false;
    };
  }, [sessionId, path, version]);

  useEffect(() => {
    if (!isMobile && path !== null) diffBarRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [isMobile, path]);

  if (report.error) return <MessageBar intent={/not ready/.test(report.error) ? "info" : "error"}><MessageBarBody>{report.error}</MessageBarBody></MessageBar>;
  const r = report.data;
  if (r === null) return <Spinner size="tiny" label={t("chat.changes.reading")} />;

  const diffContent = path !== null && (
    <>
      {diffError && (
        <MessageBar intent="error">
          <MessageBarBody>{diffError}</MessageBarBody>
        </MessageBar>
      )}
      {diff === null && !diffError && <Spinner size="tiny" />}
      {diff && diff.binary && <Text size={200}>{t("chat.changes.binaryNotShown", { path: diff.path })}</Text>}
      {diff && diff.tooLarge && <Text size={200}>{t("chat.changes.tooLarge", { path: diff.path })}</Text>}
      {diff && diff.diff !== null && (
        <>
          <div ref={diffBarRef} className={s.diffBar}>
            {!isMobile && (
              <Text size={200} className={s.path} title={diff.path}>
                {diff.path}
              </Text>
            )}
            <ToggleButton className={s.wrapBtn} size="small" appearance="subtle" icon={<TextWrap16Regular />} checked={wrap} onClick={() => setWrap((w) => !w)}>
              {t("chat.changes.wrapLines")}
            </ToggleButton>
          </div>
          <DiffView diff={diff.diff} language={diff.language} wrap={wrap} compact={isMobile} />
        </>
      )}
    </>
  );

  if (isMobile && path !== null) {
    const selected = r.files.find((f) => f.path === path);
    return (
      <div className={s.root}>
        <div className={s.diffBar}>
          <Button className={s.backBtn} appearance="subtle" icon={<ArrowLeft16Regular />} onClick={() => setPath(null)}>
            {t("chat.changes.filesBack")}
          </Button>
          <ToggleButton className={s.wrapBtn} size="small" appearance="subtle" icon={<TextWrap16Regular />} checked={wrap} onClick={() => setWrap((w) => !w)}>
            {t("chat.changes.wrapLines")}
          </ToggleButton>
        </div>
        <div className={s.filePill}>
          <Text size={200} className={s.path} title={path}>
            {path}
          </Text>
          {selected && !selected.binary && (
            <Text size={200}>
              <span className={s.add}>+{selected.additions ?? "?"}</span> <span className={s.del}>−{selected.deletions ?? "?"}</span>
            </Text>
          )}
        </div>
        {diffError && (
          <MessageBar intent="error">
            <MessageBarBody>{diffError}</MessageBarBody>
          </MessageBar>
        )}
        {diff === null && !diffError && <Spinner size="tiny" />}
        {diff && diff.binary && <Text size={200}>{t("chat.changes.binaryNotShown", { path: diff.path })}</Text>}
        {diff && diff.tooLarge && <Text size={200}>{t("chat.changes.tooLarge", { path: diff.path })}</Text>}
        {diff && diff.diff !== null && <DiffView diff={diff.diff} language={diff.language} wrap={wrap} compact />}
      </div>
    );
  }

  return (
    <div className={s.root}>
      <div className={s.row}>
        <Text weight="semibold">
          {t("chat.changes.summary", {
            count: r.totals.files,
            word: t(r.totals.files === 1 ? "chat.changes.fileWordOne" : "chat.changes.fileWordMany"),
          })}
          <span className={s.add}>+{r.totals.additions}</span> <span className={s.del}>−{r.totals.deletions}</span>
        </Text>
        <Button className={isMobile ? s.touchBtn : undefined} appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={() => void report.reload()} aria-label={t("chat.changes.refreshAria")} />
      </div>
      <div className={s.meta}>
        <Text size={200}>{t("chat.changes.branch")}</Text>
        <Text size={200} className={s.mono}>
          {r.baseBranch ? t("chat.changes.branchValue", { current: r.currentBranch ?? t("chat.changes.detached"), base: r.baseBranch }) : (r.currentBranch ?? t("chat.changes.detached"))}
        </Text>
        <Text size={200}>{t("chat.changes.startedAt")}</Text>
        <Text size={200} className={s.mono}>{r.baseCommit?.slice(0, 12) ?? "?"}</Text>
        <Text size={200}>{t("chat.changes.currentCommit")}</Text>
        <Text size={200} className={s.mono}>{r.headCommit?.slice(0, 12) ?? "?"}</Text>
      </div>
      {r.files.length === 0 && <Text size={200}>{t("chat.changes.none")}</Text>}
      <ul className={mergeClasses(s.list, !isMobile && path !== null && s.listBounded)} aria-label={t("chat.changes.changedFilesAria")}>
        {r.files.map((f) => (
          <li
            key={f.path}
            className={mergeClasses(s.file, isMobile && s.fileMobile, path === f.path && s.chosen)}
            onClick={() => setPath((prev) => (prev === f.path ? null : f.path))}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                if (e.key === " ") e.preventDefault();
                setPath((prev) => (prev === f.path ? null : f.path));
              }
            }}
          >
            <Badge size="small" appearance="tint" color={KIND[f.kind].color} aria-label={f.kind}>
              {KIND[f.kind].label}
            </Badge>
            <span className={s.path} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              {f.oldPath ? `${f.oldPath} → ` : ""}
              {f.path}
            </span>
            {f.binary ? (
              <Badge size="small" appearance="outline">
                {t("chat.changes.binaryBadge")}
              </Badge>
            ) : (
              <Text size={200}>
                <span className={s.add}>+{f.additions ?? "?"}</span> <span className={s.del}>−{f.deletions ?? "?"}</span>
              </Text>
            )}
            {isMobile && <ChevronRight16Regular aria-hidden />}
          </li>
        ))}
      </ul>
      {diffContent}
    </div>
  );
}
