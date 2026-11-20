// ADD SOURCES to a research workspace: upload files (picked or dropped, several at once, each with its progress and what
// came of it), a web page by its URL (the server fetches it and keeps a snapshot), a text pasted, or -- for this
// session -- sources the workspace already has. A file research cannot read is said to be one, never "added".
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Radio,
  RadioGroup,
  Tab,
  TabList,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { ArrowUpload20Regular, CheckmarkCircle16Regular, ErrorCircle16Regular } from "@fluentui/react-icons";
import { RESEARCH_LIMITS, RESEARCH_UPLOAD_EXTENSIONS, type ResearchSourceSummary } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../services/api";
import { research } from "./api";
import { SourceIcon } from "./labels";

const useStyles = makeStyles({
  surface: { width: "min(640px, 96vw)", maxWidth: "min(640px, 96vw)" },
  body: { display: "flex", flexDirection: "column", gap: "14px", minHeight: "280px" },
  drop: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    minHeight: "140px",
    borderRadius: "14px",
    border: `1px dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    textAlign: "center",
    paddingTop: "16px",
    paddingRight: "16px",
    paddingBottom: "16px",
    paddingLeft: "16px",
  },
  dropActive: { border: `1px dashed ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorBrandBackground2 },
  files: { listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0, display: "flex", flexDirection: "column", gap: "8px", maxHeight: "220px", overflowY: "auto" },
  file: { display: "flex", flexDirection: "column", gap: "4px" },
  fileHead: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  fileName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ok: { color: tokens.colorPaletteGreenForeground1 },
  bad: { color: tokens.colorPaletteRedForeground1 },
  muted: { color: tokens.colorNeutralForeground3 },
  existing: { display: "flex", flexDirection: "column", gap: "4px", maxHeight: "260px", overflowY: "auto" },
  existingRow: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
});

type Mode = "upload" | "url" | "text" | "existing";

interface Item {
  key: string;
  file: File;
  progress: number;
  status: "waiting" | "uploading" | "done" | "refused";
  message: string | null;
}

const UPLOADS_AT_ONCE = 2;

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
};

export interface AddSourcesDialogProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: ResearchSourceSummary[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  // A source was added (it is offered to this session).
  onAdded: (source: ResearchSourceSummary) => void;
}

export function AddSourcesDialog(p: AddSourcesDialogProps) {
  const s = useStyles();
  const [mode, setMode] = useState<Mode>("upload");
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => p.onOpenChange(d.open)}>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>Add sources</DialogTitle>
          <DialogContent className={s.body}>
            <TabList size="small" selectedValue={mode} onTabSelect={(_, d) => setMode(d.value as Mode)}>
              <Tab value="upload">Upload</Tab>
              <Tab value="url">Website</Tab>
              <Tab value="text">Paste text</Tab>
              <Tab value="existing">From this workspace</Tab>
            </TabList>
            {mode === "upload" && <UploadTab {...p} />}
            {mode === "url" && <UrlTab {...p} />}
            {mode === "text" && <TextTab {...p} />}
            {mode === "existing" && <ExistingTab {...p} />}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => p.onOpenChange(false)}>Done</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function UploadTab(p: AddSourcesDialogProps) {
  const s = useStyles();
  const [items, setItems] = useState<Item[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(0);
  const { workspaceId, onAdded } = p;

  const update = (key: string, change: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...change } : i)));
  const add = (files: FileList | File[]) =>
    setItems((list) => [
      ...list,
      ...[...files].map((file, n) => {
        const known = (RESEARCH_UPLOAD_EXTENSIONS as readonly string[]).includes(extensionOf(file.name));
        return { key: `${Date.now()}-${n}-${file.name}`, file, progress: 0, status: known ? ("waiting" as const) : ("refused" as const), message: known ? null : `Research does not read this kind of file (it reads ${RESEARCH_UPLOAD_EXTENSIONS.join(" ")}).` };
      }),
    ]);

  // A few at a time, in the order they were added.
  useEffect(() => {
    const next = items.filter((i) => i.status === "waiting").slice(0, Math.max(0, UPLOADS_AT_ONCE - running.current));
    for (const item of next) {
      running.current += 1;
      update(item.key, { status: "uploading" });
      research
        .upload(workspaceId, item.file, (f) => update(item.key, { progress: f }))
        .then(
          (source) => {
            update(item.key, { status: "done", progress: 1, message: "Added: it is read and indexed now." });
            onAdded(source);
          },
          (err: unknown) => update(item.key, { status: "refused", message: errorText(err) }),
        )
        .finally(() => {
          running.current -= 1;
          setItems((list) => [...list]);
        });
    }
  }, [items, workspaceId, onAdded]);

  return (
    <>
      <div
        className={mergeClasses(s.drop, over && s.dropActive)}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        data-testid="drop-zone"
      >
        <ArrowUpload20Regular />
        <Text>Drop files here, or</Text>
        <Button appearance="primary" onClick={() => input.current?.click()}>
          Choose files
        </Button>
        <Text size={200} className={s.muted}>
          PDF, Word (.docx), text, Markdown and web pages (.html). A PDF made of scanned images has no text research can read.
        </Text>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label="Choose files to upload"
          accept={RESEARCH_UPLOAD_EXTENSIONS.join(",")}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {items.length > 0 && (
        <ul className={s.files} aria-label="Uploads">
          {items.map((i) => (
            <li key={i.key} className={s.file}>
              <div className={s.fileHead}>
                {i.status === "done" && <CheckmarkCircle16Regular className={s.ok} />}
                {i.status === "refused" && <ErrorCircle16Regular className={s.bad} />}
                <span className={s.fileName}>{i.file.name}</span>
                <Text size={200} className={s.muted}>
                  {i.status === "waiting" ? "Waiting" : i.status === "uploading" ? `${Math.round(i.progress * 100)}%` : i.status === "done" ? "Added" : "Not added"}
                </Text>
              </div>
              {(i.status === "uploading" || i.status === "waiting") && <ProgressBar value={i.progress} aria-label={`Uploading ${i.file.name}`} />}
              {i.message && (
                <Text size={200} className={i.status === "refused" ? s.bad : s.muted}>
                  {i.message}
                </Text>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function UrlTab(p: AddSourcesDialogProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const source = await research.addUrl(p.workspaceId, url.trim(), title.trim() || undefined);
      p.onAdded(source);
      setDone(`Fetching ${source.title}: Orbit Web keeps a snapshot of it, so the page changing later does not change your research.`);
      setUrl("");
      setTitle("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Field label="Website URL" hint="http or https. The Orbit server fetches it -- only from the public internet -- and keeps what it read.">
        <Input type="url" value={url} onChange={(_, d) => setUrl(d.value)} placeholder="https://example.com/article" maxLength={RESEARCH_LIMITS.urlLength} required />
      </Field>
      <Field label="Title (optional)">
        <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} />
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {done && (
        <MessageBar intent="success">
          <MessageBarBody>{done}</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Button appearance="primary" type="submit" disabled={busy || url.trim() === ""}>
          Add website
        </Button>
      </div>
    </form>
  );
}

function TextTab(p: AddSourcesDialogProps) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"markdown" | "text">("markdown");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const source = await research.addText(p.workspaceId, title.trim(), text, format);
      p.onAdded(source);
      setDone(`Added “${source.title}”.`);
      setTitle("");
      setText("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <Field label="Title" required>
        <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} />
      </Field>
      <Field label="Text" hint={`Up to ${RESEARCH_LIMITS.pastedTextLength.toLocaleString()} characters.`} required>
        <Textarea value={text} onChange={(_, d) => setText(d.value)} resize="vertical" rows={8} maxLength={RESEARCH_LIMITS.pastedTextLength} />
      </Field>
      <RadioGroup layout="horizontal" value={format} onChange={(_, d) => setFormat(d.value as "markdown" | "text")} aria-label="Format">
        <Radio value="markdown" label="Markdown" />
        <Radio value="text" label="Plain text" />
      </RadioGroup>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {done && (
        <MessageBar intent="success">
          <MessageBarBody>{done}</MessageBarBody>
        </MessageBar>
      )}
      <div>
        <Button appearance="primary" type="submit" disabled={busy || title.trim() === "" || text.trim() === ""}>
          Add text
        </Button>
      </div>
    </form>
  );
}

function ExistingTab(p: AddSourcesDialogProps) {
  const s = useStyles();
  const unused = p.sources.filter((x) => !p.selection.includes(x.id));
  const [picked, setPicked] = useState<string[]>([]);
  if (unused.length === 0) return <Text className={s.muted}>Every source of this workspace is already used in this session.</Text>;
  return (
    <div className={s.existing}>
      <Text size={200} className={s.muted}>
        These are already stored in the workspace: nothing is uploaded again.
      </Text>
      {unused.map((x) => (
        <div key={x.id} className={s.existingRow}>
          <Checkbox checked={picked.includes(x.id)} onChange={(_, d) => setPicked((list) => (d.checked === true ? [...list, x.id] : list.filter((id) => id !== x.id)))} label={x.title} />
          <SourceIcon source={x} />
        </div>
      ))}
      <div>
        <Button
          appearance="primary"
          disabled={picked.length === 0}
          onClick={() => {
            p.onSelect([...p.selection, ...picked]);
            setPicked([]);
          }}
        >
          Use in this session
        </Button>
      </div>
    </div>
  );
}
