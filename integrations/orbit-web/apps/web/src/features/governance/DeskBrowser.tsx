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
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { bytesText, sizeText } from "../resources/format";
import { Card, ErrorBar, Word, useParts, when } from "./parts";

// Past this, a file's text is shown plain: highlighting it would slow the page down.
const HIGHLIGHT_MAX = 64 * 1024;
const languageOf = (path: string): string | null => /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase() ?? null;
const kept = (e: DeskEntry): boolean => e.path === null || (DESK_TOOLBOX_DIRS as readonly string[]).includes(e.path);

type Ask = { kind: "remove"; paths: string[] } | { kind: "empty" } | { kind: "cache" };

const ASK_TEXT: Record<Ask["kind"], { title: (name: string, n: number) => string; act: string }> = {
  remove: { title: (name, n) => `Remove ${n} from ${name}'s desk?`, act: "Remove" },
  empty: { title: (name) => `Empty ${name}'s desk, keeping the toolbox?`, act: "Empty the desk" },
  cache: { title: (name) => `Empty ${name}'s dependency cache?`, act: "Empty the cache" },
};

const resultText = (r: DeskCleanResult): string =>
  `Removed ${r.removed} ${r.removed === 1 ? "entry" : "entries"}${r.paths.length > 0 ? ` (${r.paths.slice(0, 5).join(", ")}${r.paths.length > 5 ? ", …" : ""})` : ""}.` +
  `${r.cacheEmptied ? " The cache was emptied." : ""}${r.missing.length > 0 ? ` Not there any more: ${r.missing.join(", ")}.` : ""}`;

function FileView({ base, path }: { base: string; path: string }) {
  const s = useParts();
  const file = useResource<DeskFile>(() => get(`${base}/file?path=${encodeURIComponent(path)}`), [base, path]);
  const f = file.data;
  return (
    <Card title={path} icon={<Document16Regular />} tone="neutral" description={f === null ? undefined : `${bytesText(f.bytes)} · changed ${when(f.modifiedAt)}`}>
      {f === null ? (
        file.error ? <ErrorBar text={file.error} /> : <Spinner size="tiny" label="Reading the file…" />
      ) : f.text === null ? (
        <Text className={s.muted}>Not text: {bytesText(f.bytes)}. What it holds is not shown here.</Text>
      ) : (
        <>
          {f.truncated && <Text className={s.muted}>Only the first {bytesText(f.text.length)} of {bytesText(f.bytes)} is shown.</Text>}
          <CodeBlock code={f.text} language={f.text.length <= HIGHLIGHT_MAX ? languageOf(path) : null} />
        </>
      )}
    </Card>
  );
}

export function DeskBrowser({ employeeId, go }: { employeeId: string; go: (page: GovernancePage, item?: string | null) => void }) {
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
        All desks
      </Button>
    </div>
  );
  if (tree.data === null)
    return (
      <div className={s.page}>
        {back}
        {tree.error ? <ErrorBar text={tree.error} /> : <Spinner label="Reading the desk…" />}
      </div>
    );
  const t = tree.data;
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
      setSaid({ intent: "success", text: resultText(await send<DeskCleanResult>("POST", `${base}/clean`, body, ifMatch(t.deskVersion))) });
      setChosen([]);
      setChoosing(false);
      setOpen(null);
    } catch (err) {
      setSaid({ intent: "warning", text: isStale(err) ? "The desk changed since you opened it: nothing was removed. It is read again below." : errorText(err) });
    } finally {
      setBusy(false);
      void tree.reload();
    }
  };
  const segments = t.dir === "" ? [] : t.dir.split("/");
  const used = t.storage;
  const measured =
    used.deskUsedMiB === null
      ? "Not measured yet"
      : `${sizeText(used.deskUsedMiB)} of ${sizeText(used.deskQuotaMiB)} measured in the desk${used.cacheUsedMiB !== null && used.cacheQuotaMiB > 0 ? `, ${sizeText(used.cacheUsedMiB)} of ${sizeText(used.cacheQuotaMiB)} in its cache` : ""} · ${when(used.measuredAt)}`;
  const can = t.clean.allowed && !busy;
  const toggle = (path: string, on: boolean) => setChosen((c) => (on ? [...c, path] : c.filter((p) => p !== path)));
  return (
    <div className={s.page}>
      {back}
      <Card
        title={
          <>
            {t.employee.name}'s desk <Word value={t.employee.employment} />
          </>
        }
        icon={<DesksIcon size={18} />}
        tone="neutral"
        description={`${measured} · desk version ${t.deskVersion}. Read only: what its accepted work left, and the toolbox it wrote for itself. Every look is recorded in the audit.`}
        actions={
          <>
            <Button size="small" disabled={!can} onClick={() => (setChoosing((c) => !c), setChosen([]))}>
              {choosing ? "Done choosing" : "Clean up…"}
            </Button>
            <Button size="small" disabled={!can} onClick={() => setAsk({ kind: "empty" })}>
              Empty the desk, keep the toolbox…
            </Button>
            {(used.cacheQuotaMiB > 0 || (used.cacheUsedMiB ?? 0) > 0) && (
              <Button size="small" disabled={!can} onClick={() => setAsk({ kind: "cache" })}>
                Empty the cache…
              </Button>
            )}
          </>
        }
      >
        {!t.clean.allowed && t.clean.why !== null && <Text className={s.muted}>Not cleaned up now: {t.clean.why}</Text>}
        {said !== null && (
          <MessageBar intent={said.intent}>
            <MessageBarBody>{said.text}</MessageBarBody>
          </MessageBar>
        )}
        <nav aria-label="Folder" className={s.row}>
          <Button size="small" appearance="transparent" onClick={() => into("")}>
            Desk
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
          {bytesText(t.bytes)} in {t.files} {t.files === 1 ? "file" : "files"}
          {t.truncated ? ` · the ${t.entries.length} biggest are shown` : ""}
        </Text>
        <Table size="small" aria-label="What the desk holds">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Size</TableHeaderCell>
              <TableHeaderCell>Files</TableHeaderCell>
              <TableHeaderCell>Changed</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {t.entries.map((e) => (
              <TableRow key={e.path ?? `?${e.name}`}>
                <TableCell>
                  <span className={s.row}>
                    {choosing && e.path !== null && !kept(e) && <Checkbox aria-label={`Choose ${e.name}`} checked={chosen.includes(e.path)} onChange={(_, d) => toggle(e.path as string, d.checked === true)} />}
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
        {t.entries.length === 0 && <Text className={s.muted}>This folder is empty.</Text>}
        {choosing && (
          <div className={s.row}>
            <Button size="small" appearance="primary" icon={<Delete16Regular />} disabled={chosen.length === 0 || !can} onClick={() => setAsk({ kind: "remove", paths: chosen })}>
              Remove {chosen.length}…
            </Button>
            <Text size={200} className={s.muted}>
              The toolbox's folders stay; what is in them may be chosen.
            </Text>
          </div>
        )}
      </Card>
      {open !== null && <FileView key={open} base={base} path={open} />}
      {ask !== null && (
        <Dialog open onOpenChange={(_, v) => !v.open && setAsk(null)}>
          <DialogSurface className="orbit-touch">
            <DialogBody>
              <DialogTitle>{ASK_TEXT[ask.kind].title(t.employee.name, ask.kind === "remove" ? ask.paths.length : 0)}</DialogTitle>
              <DialogContent>
                {ask.kind === "remove" && (
                  <ul>
                    {ask.paths.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                {ask.kind === "empty" && <p>Everything in the desk but toolbox/ is removed: the files its accepted work left there.</p>}
                {ask.kind === "cache" && <p>The packages it downloaded (pip, npm and the like) are removed; its tools download them again when they need them.</p>}
                <p>This cannot be undone. Its next work starts from what is left.</p>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setAsk(null)}>Cancel</Button>
                <Button appearance="primary" onClick={() => void clean(ask)}>
                  {ASK_TEXT[ask.kind].act}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </div>
  );
}
