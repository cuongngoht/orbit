// What changed in the workspace, read from git there: the files against the commit the chat started from, their
// line counts, and a file's diff on request.
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular } from "@fluentui/react-icons";
import type { ChangeKind, ChangesReport, FileDiff } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get } from "../../services/api";
import { DiffView } from "./DiffView";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "10px" },
  meta: { color: tokens.colorNeutralForeground3, display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "10px", rowGap: "2px" },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "2px" },
  file: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 6px", borderRadius: tokens.borderRadiusSmall, cursor: "pointer", ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover } },
  chosen: { backgroundColor: tokens.colorNeutralBackground1Selected },
  path: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  add: { color: tokens.colorPaletteGreenForeground1 },
  del: { color: tokens.colorPaletteRedForeground1 },
  row: { display: "flex", gap: "8px", alignItems: "center" },
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
  const s = useStyles();
  const report = useResource<ChangesReport>(() => get(`/api/sessions/${sessionId}/changes`), [sessionId]);
  const [path, setPath] = useState<string | null>(null);
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

  if (report.error) return <MessageBar intent={/not ready/.test(report.error) ? "info" : "error"}><MessageBarBody>{report.error}</MessageBarBody></MessageBar>;
  const r = report.data;
  if (r === null) return <Spinner size="tiny" label="Reading the workspace…" />;
  return (
    <div className={s.root}>
      <div className={s.row}>
        <Text weight="semibold">
          {r.totals.files} file{r.totals.files === 1 ? "" : "s"} changed <span className={s.add}>+{r.totals.additions}</span> <span className={s.del}>−{r.totals.deletions}</span>
        </Text>
        <Button appearance="subtle" size="small" icon={<ArrowClockwise16Regular />} onClick={() => void report.reload()} aria-label="Refresh changes" />
      </div>
      <div className={s.meta}>
        <Text size={200}>Branch</Text>
        <Text size={200} className={s.mono}>{r.currentBranch ?? "(detached)"} from {r.baseBranch}</Text>
        <Text size={200}>Started at</Text>
        <Text size={200} className={s.mono}>{r.baseCommit?.slice(0, 12) ?? "?"}</Text>
        <Text size={200}>Current commit</Text>
        <Text size={200} className={s.mono}>{r.headCommit?.slice(0, 12) ?? "?"}</Text>
      </div>
      {r.files.length === 0 && <Text size={200}>No changes in the workspace.</Text>}
      <ul className={s.list} aria-label="Changed files">
        {r.files.map((f) => (
          <li key={f.path} className={mergeClasses(s.file, path === f.path && s.chosen)} onClick={() => setPath(f.path)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === "Enter" ? setPath(f.path) : undefined)}>
            <Badge size="small" appearance="tint" color={KIND[f.kind].color} aria-label={f.kind}>
              {KIND[f.kind].label}
            </Badge>
            <span className={s.path} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
              {f.oldPath ? `${f.oldPath} → ` : ""}
              {f.path}
            </span>
            {f.binary ? (
              <Badge size="small" appearance="outline">
                binary
              </Badge>
            ) : (
              <Text size={200}>
                <span className={s.add}>+{f.additions ?? "?"}</span> <span className={s.del}>−{f.deletions ?? "?"}</span>
              </Text>
            )}
          </li>
        ))}
      </ul>
      {path !== null && diffError && (
        <MessageBar intent="error">
          <MessageBarBody>{diffError}</MessageBarBody>
        </MessageBar>
      )}
      {path !== null && diff === null && !diffError && <Spinner size="tiny" />}
      {diff && diff.binary && <Text size={200}>{diff.path} is a binary file; its content is not shown.</Text>}
      {diff && diff.tooLarge && <Text size={200}>The diff of {diff.path} is too large to show here.</Text>}
      {diff && diff.diff !== null && <DiffView diff={diff.diff} language={diff.language} />}
    </div>
  );
}
