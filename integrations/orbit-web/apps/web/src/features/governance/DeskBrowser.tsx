// AN EMPLOYEE'S DESK, LOOKED INTO AND CLEANED UP (Governance → Employee desks → one desk). Read only: one folder at a
// time, the biggest first, with what each folder holds; a file opens as text -- shown, never run (a page's markup is
// text here) -- and a file that is not text is only named and sized. Every look is the account policy's to decide and is
// recorded in the audit. The desk is cleaned up -- chosen paths, everything but the toolbox, the dependency cache --
// only when its employee holds no work, and only at the version the person chose at: each clean is said in full first.
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from "@fluentui/react-components";
import { ArrowLeft16Regular, ChevronRight12Regular, Delete16Regular, Document16Regular, Folder16Regular, Link16Regular } from "@fluentui/react-icons";
import { DESK_TOOLBOX_DIRS, type DeskCleanRequest, type DeskCleanResult, type DeskEntry, type DeskFile, type DeskTree } from "@orbit-web/contracts";
import { useState } from "react";
import { CodeBlock } from "../../components/CodeBlock";
import { DesksIcon } from "../../components/SectionIcons";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { bytesText, sizeText } from "../resources/format";
import { Card, ErrorBar, Word, plural, useParts, when } from "./parts";

// Past this, a file's text is shown plain: highlighting it would slow the page down.
const HIGHLIGHT_MAX = 64 * 1024;
const languageOf = (path: string): string | null => /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? null;
const kept = (e: DeskEntry): boolean => e.path === null || (DESK_TOOLBOX_DIRS as readonly string[]).includes(e.path);

type Ask = { kind: "remove"; paths: string[] } | { kind: "empty" } | { kind: "cache" };

const ASK_KEYS: Record<Ask["kind"], { titleKey: MessageKey; actKey: MessageKey }> = {
  remove: { titleKey: "governance.desk.ask.removeTitle", actKey: "governance.desk.ask.removeAct" },
  empty: { titleKey: "governance.desk.ask.emptyTitle", actKey: "governance.desk.ask.emptyAct" },
  cache: { titleKey: "governance.desk.ask.cacheTitle", actKey: "governance.desk.ask.cacheAct" },
};

const resultText = (r: DeskCleanResult): string => {
  const paths = r.paths.length > 0 ? ` (${r.paths.slice(0, 5).join(", ")}${r.paths.length > 5 ? ", …" : ""})` : "";
  const removed = tr("governance.desk.result.removed", {
    count: r.removed,
    word: tr(r.removed === 1 ? "governance.desk.result.entryOne" : "governance.desk.result.entryMany"),
    paths,
  });
  return `${removed}${r.cacheEmptied ? tr("governance.desk.result.cacheEmptied") : ""}${r.missing.length > 0 ? tr("governance.desk.result.missing", { missing: r.missing.join(", ") }) : ""}`;
};

function FileView({ base, path }: { base: string; path: string }) {
  const { t } = useI18n();
  const s = useParts();
  const file = useResource<DeskFile>(() => get(`${base}/file?path=${encodeURIComponent(path)}`), [base, path]);
  const f = file.data;
  return (
    <Card title={path} icon={<Document16Regular />} tone="neutral" description={f === null ? undefined : t("governance.desk.fileMeta", { bytes: bytesText(f.bytes), at: when(f.modifiedAt) })}>
      {f === null ? (
        file.error ? <ErrorBar text={file.error} /> : <Spinner size="tiny" label={t("governance.desk.readingFile")} />
      ) : f.text === null ? (
        <Text className={s.muted}>{t("governance.desk.notText", { bytes: bytesText(f.bytes) })}</Text>
      ) : (
        <>
          {f.truncated && <Text className={s.muted}>{t("governance.desk.truncatedFile", { shown: bytesText(f.text.length), total: bytesText(f.bytes) })}</Text>}
          <CodeBlock code={f.text} language={f.text.length <= HIGHLIGHT_MAX ? languageOf(path) : null} />
        </>
      )}
    </Card>
  );
}

export function DeskBrowser({ employeeId, go }: { employeeId: string; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const [dir, setDir] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ intent: "success" | "warning"; text: string } | null>(null);
  const base = `/api/employees/${encodeURIComponent(employeeId)}/desk`;
  const tree = useResource<DeskTree>(() => get(dir === "" ? base : `${base}?dir=${encodeURIComponent(dir)}`), [base, dir]);
  const back = (
    <div>
      <Button appearance="subtle" shape="circular" icon={<ArrowLeft16Regular />} onClick={() => go("desks")}>
        {t("governance.desk.allDesks")}
      </Button>
    </div>
  );
  if (tree.data === null)
    return (
      <div className={s.page}>
        {back}
        {tree.error ? <ErrorBar text={tree.error} /> : <Spinner label={t("governance.desk.readingDesk")} />}
      </div>
    );
  const desk = tree.data;
  const into = (d: string) => {
    setDir(d);
    setOpen(null);
    setChosen([]);
  };
  const clean = async (a: Ask) => {
    setAsk(null);
    setBusy(true);
    setSaid(null);
    const body: DeskCleanRequest = a.kind === "remove" ? { remove: a.paths } : a.kind === "empty" ? { empty: true } : { cache: true };
    try {
      setSaid({ intent: "success", text: resultText(await send<DeskCleanResult>("POST", `${base}/clean`, body, ifMatch(desk.deskVersion))) });
      setChosen([]);
      setChoosing(false);
      setOpen(null);
    } catch (err) {
      setSaid({ intent: "warning", text: isStale(err) ? t("governance.desk.staleClean") : errorText(err) });
    } finally {
      setBusy(false);
      void tree.reload();
    }
  };
  const segments = desk.dir === "" ? [] : desk.dir.split("/");
  const used = desk.storage;
  const cachePart = used.cacheUsedMiB !== null && used.cacheQuotaMiB > 0 ? t("governance.desk.measuredCache", { used: sizeText(used.cacheUsedMiB), quota: sizeText(used.cacheQuotaMiB) }) : "";
  const measured =
    used.deskUsedMiB === null
      ? t("governance.desk.notMeasuredYet")
      : t("governance.desk.measuredSummary", {
          used: sizeText(used.deskUsedMiB),
          quota: sizeText(used.deskQuotaMiB),
          cache: cachePart,
          at: when(used.measuredAt),
        });
  const can = desk.clean.allowed && !busy;
  const toggle = (path: string, on: boolean) => setChosen((c) => (on ? [...c, path] : c.filter((p) => p !== path)));
  return (
    <div className={s.page}>
      {back}
      <Card
        title={
          <>
            {t("governance.desk.title", { name: desk.employee.name })}
            <Word value={desk.employee.employment} />
          </>
        }
        icon={<DesksIcon size={18} />}
        tone="neutral"
        description={t("governance.desk.description", { measured, version: desk.deskVersion })}
        actions={
          <>
            <Button size="small" disabled={!can} onClick={() => (setChoosing((c) => !c), setChosen([]))}>
              {choosing ? t("governance.desk.doneChoosing") : t("governance.desk.cleanUp")}
            </Button>
            <Button size="small" disabled={!can} onClick={() => setAsk({ kind: "empty" })}>
              {t("governance.desk.emptyKeepToolbox")}
            </Button>
            {(used.cacheQuotaMiB > 0 || (used.cacheUsedMiB ?? 0) > 0) && (
              <Button size="small" disabled={!can} onClick={() => setAsk({ kind: "cache" })}>
                {t("governance.desk.emptyCache")}
              </Button>
            )}
          </>
        }
      >
        {!desk.clean.allowed && desk.clean.why !== null && <Text className={s.muted}>{t("governance.desk.notCleanedNow", { why: desk.clean.why })}</Text>}
        {said !== null && (
          <MessageBar intent={said.intent}>
            <MessageBarBody>{said.text}</MessageBarBody>
          </MessageBar>
        )}
        <nav aria-label={t("governance.desk.folderAria")} className={s.row}>
          <Button size="small" appearance="transparent" onClick={() => into("")}>
            {t("governance.desk.rootName")}
          </Button>
          {segments.map((seg, i) => (
            <span key={`${i}:${seg}`} className={s.row}>
              <ChevronRight12Regular aria-hidden />
              <Button size="small" appearance="transparent" onClick={() => into(segments.slice(0, i + 1).join("/"))}>
                {seg}
              </Button>
            </span>
          ))}
        </nav>
        <Text size={200} className={s.muted}>
          {t("governance.desk.fileCount", {
            bytes: bytesText(desk.bytes),
            count: desk.files,
            word: t(desk.files === 1 ? "governance.desk.fileOne" : "governance.desk.fileMany"),
            truncated: desk.truncated ? t("governance.desk.biggestShown", { count: desk.entries.length }) : "",
          })}
        </Text>
        <Table size="small" aria-label={t("governance.desk.holdsAria")}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("governance.desk.colName")}</TableHeaderCell>
              <TableHeaderCell>{t("governance.desk.colSize")}</TableHeaderCell>
              <TableHeaderCell>{t("governance.desk.colFiles")}</TableHeaderCell>
              <TableHeaderCell>{t("governance.desk.colChanged")}</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {desk.entries.map((e) => (
              <TableRow key={e.path ?? `?${e.name}`}>
                <TableCell>
                  <span className={s.row}>
                    {choosing && e.path !== null && !kept(e) && <Checkbox aria-label={t("governance.desk.chooseAria", { name: e.name })} checked={chosen.includes(e.path)} onChange={(_, d) => toggle(e.path as string, d.checked === true)} />}
                    {e.type === "dir" ? <Folder16Regular aria-hidden /> : e.type === "link" ? <Link16Regular aria-hidden /> : <Document16Regular aria-hidden />}
                    {e.path === null || e.type === "link" || e.type === "other" ? (
                      <Text>{e.type === "link" ? `${e.name} → ${e.target ?? ""}` : e.name}</Text>
                    ) : (
                      <Button size="small" appearance="transparent" onClick={() => (e.type === "dir" ? into(e.path as string) : setOpen(e.path))}>
                        {e.name}
                      </Button>
                    )}
                  </span>
                </TableCell>
                <TableCell>{e.type === "link" ? "—" : bytesText(e.bytes)}</TableCell>
                <TableCell>{e.type === "dir" ? e.files : ""}</TableCell>
                <TableCell>{when(e.modifiedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {desk.entries.length === 0 && <Text className={s.muted}>{t("governance.desk.emptyFolder")}</Text>}
        {choosing && (
          <div className={s.row}>
            <Button size="small" appearance="primary" icon={<Delete16Regular />} disabled={chosen.length === 0 || !can} onClick={() => setAsk({ kind: "remove", paths: chosen })}>
              {t("governance.desk.removeCount", { count: chosen.length })}
            </Button>
            <Text size={200} className={s.muted}>
              {t("governance.desk.toolboxFoldersStay")}
            </Text>
          </div>
        )}
      </Card>
      {open !== null && <FileView key={open} base={base} path={open} />}
      {ask !== null && (
        <Dialog open onOpenChange={(_, v) => !v.open && setAsk(null)}>
          <DialogSurface className="orbit-touch">
            <DialogBody>
              <DialogTitle>
                {t(ASK_KEYS[ask.kind].titleKey, {
                  name: desk.employee.name,
                  count: ask.kind === "remove" ? plural(ask.paths.length, t("governance.desk.result.entryOne"), t("governance.desk.result.entryMany")).split(" ")[0] ? ask.paths.length : 0 : 0,
                })}
              </DialogTitle>
              <DialogContent>
                {ask.kind === "remove" && (
                  <ul>
                    {ask.paths.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {ask.kind === "empty" && <p>{t("governance.desk.emptyWarning")}</p>}
                {ask.kind === "cache" && <p>{t("governance.desk.cacheWarning")}</p>}
                <p>{t("governance.desk.cannotBeUndone")}</p>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setAsk(null)}>{t("governance.approval.cancel")}</Button>
                <Button appearance="primary" onClick={() => void clean(ask)}>
                  {t(ASK_KEYS[ask.kind].actKey)}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </div>
  );
}
