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
  DialogTrigger,
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
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { ArrowUpload20Regular, CheckmarkCircle16Regular, Dismiss20Regular, ErrorCircle16Regular } from "@fluentui/react-icons";
import { RESEARCH_LIMITS, RESEARCH_UPLOAD_EXTENSIONS, type ResearchSourceSummary } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { research } from "./api";
import { SourceIcon } from "./labels";

const useStyles = makeStyles({
  surface: {
    width: "min(620px, 94vw)",
    maxWidth: "min(620px, 94vw)",
    borderRadius: "20px",
    backgroundColor: "var(--orbit-card-bg)",
    overflow: "hidden",
  },
  body: { display: "flex", flexDirection: "column", gap: "14px", minHeight: "280px", minWidth: 0 },
  tabList: {
    width: "100%",
    display: "flex",
    flexWrap: "wrap",
    gap: "4px",
    paddingTop: "4px",
    paddingRight: "4px",
    paddingBottom: "4px",
    paddingLeft: "4px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    "& [role='tab']": {
      justifyContent: "center",
      borderRadius: "9px",
      minHeight: "34px",
      paddingTop: "5px",
      paddingRight: "10px",
      paddingBottom: "5px",
      paddingLeft: "10px",
      fontSize: tokens.fontSizeBase200,
    },
    "& [role='tab']::after": { display: "none" },
    "& .fui-Tab__indicator": { display: "none" },
    "& [role='tab'][aria-selected='true']": {
      backgroundColor: "var(--orbit-card-bg)",
      boxShadow: "var(--orbit-soft-shadow)",
      color: tokens.colorNeutralForeground1,
      fontWeight: tokens.fontWeightSemibold,
    },
  },
  tabListMobile: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gridAutoRows: "1fr",
    "& [role='tab']": {
      minHeight: "38px",
      height: "100%",
      paddingRight: "6px",
      paddingLeft: "6px",
      fontSize: "12px",
      lineHeight: "1.2",
      textAlign: "center",
    },
  },
  drop: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "10px",
    minHeight: "160px",
    borderRadius: "16px",
    ...shorthands.border("1px", "dashed", tokens.colorNeutralStroke1),
    backgroundColor: "var(--orbit-tool-bg)",
    color: tokens.colorNeutralForeground2,
    textAlign: "center",
    paddingTop: "20px",
    paddingRight: "18px",
    paddingBottom: "20px",
    paddingLeft: "18px",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
  },
  dropActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  uploadEmblem: {
    width: "44px",
    height: "44px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  chooseBtn: { borderRadius: "10px", minHeight: "36px" },
  extRow: { display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px" },
  extChip: {
    fontSize: "11px",
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    paddingTop: "2px",
    paddingRight: "6px",
    paddingBottom: "2px",
    paddingLeft: "6px",
  },
  files: {
    listStyleType: "none",
    paddingLeft: 0,
    marginTop: 0,
    marginBottom: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxHeight: "220px",
    overflowY: "auto",
  },
  file: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
  },
  fileHead: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  fileName: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: tokens.fontWeightMedium },
  ok: { color: tokens.colorPaletteGreenForeground1, flexShrink: 0 },
  bad: { color: tokens.colorPaletteRedForeground1, flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  tabForm: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  field: { minWidth: 0, width: "100%", maxWidth: "100%" },
  input: { minWidth: 0, width: "100%", maxWidth: "100%" },
  existing: { display: "flex", flexDirection: "column", gap: "8px", maxHeight: "260px", overflowY: "auto" },
  existingRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minWidth: 0,
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-tool-bg)",
    paddingTop: "6px",
    paddingRight: "10px",
    paddingBottom: "6px",
    paddingLeft: "6px",
  },
  actionBtn: { borderRadius: "10px" },
  doneBtn: { borderRadius: "10px" },
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
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const [mode, setMode] = useState<Mode>("upload");
  return (
    <Dialog open={p.open} onOpenChange={(_, d) => p.onOpenChange(d.open)}>
      <DialogSurface className={mergeClasses(s.surface, "orbit-touch")}>
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger action="close" disableButtonEnhancement>
                <Button appearance="subtle" size="small" aria-label={t("research.addSources.closeAria")} icon={<Dismiss20Regular />} />
              </DialogTrigger>
            }
          >
            {t("research.addSources.title")}
          </DialogTitle>
          <DialogContent className={s.body}>
            <TabList className={mergeClasses(s.tabList, isMobile && s.tabListMobile)} size="small" selectedValue={mode} onTabSelect={(_, d) => setMode(d.value as Mode)}>
              <Tab value="upload">{t("research.addSources.tabUpload")}</Tab>
              <Tab value="url">{t("research.addSources.tabUrl")}</Tab>
              <Tab value="text">{t("research.addSources.tabText")}</Tab>
              <Tab value="existing">{t("research.addSources.tabExisting")}</Tab>
            </TabList>
            <div hidden={mode !== "upload"}>
              <UploadTab {...p} />
            </div>
            <div hidden={mode !== "url"}>
              <UrlTab {...p} />
            </div>
            <div hidden={mode !== "text"}>
              <TextTab {...p} />
            </div>
            {mode === "existing" && <ExistingTab {...p} />}
          </DialogContent>
          <DialogActions>
            <Button className={s.doneBtn} onClick={() => p.onOpenChange(false)}>
              {t("research.addSources.done")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function UploadTab(p: AddSourcesDialogProps) {
  const { t } = useI18n();
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
        return { key: `${Date.now()}-${n}-${file.name}`, file, progress: 0, status: known ? ("waiting" as const) : ("refused" as const), message: known ? null : t("research.addSources.refusedFileType", { extensions: RESEARCH_UPLOAD_EXTENSIONS.join(" ") }) };
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
            update(item.key, { status: "done", progress: 1, message: t("research.addSources.addedIndexed") });
            onAdded(source);
          },
          (err: unknown) => update(item.key, { status: "refused", message: errorText(err) }),
        )
        .finally(() => {
          running.current -= 1;
          setItems((list) => [...list]);
        });
    }
  }, [items, workspaceId, onAdded, t]);

  return (
    <>
      <div
        className={mergeClasses(s.drop, over && s.dropActive)}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        data-testid="drop-zone"
      >
        <span className={s.uploadEmblem} aria-hidden>
          <ArrowUpload20Regular />
        </span>
        <Text weight="medium">{t("research.addSources.dropPrompt")}</Text>
        <Button className={s.chooseBtn} appearance="primary" onClick={() => input.current?.click()}>
          {t("research.addSources.chooseFiles")}
        </Button>
        <div className={s.extRow} aria-hidden>
          {RESEARCH_UPLOAD_EXTENSIONS.map((ext) => (
            <span key={ext} className={s.extChip}>
              {ext}
            </span>
          ))}
        </div>
        <Text size={200} className={s.muted}>
          {t("research.addSources.uploadHint")}
        </Text>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          aria-label={t("research.addSources.chooseFilesAria")}
          accept={RESEARCH_UPLOAD_EXTENSIONS.join(",")}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {items.length > 0 && (
        <ul className={s.files} aria-label={t("research.addSources.uploadsAria")}>
          {items.map((i) => (
            <li key={i.key} className={s.file}>
              <div className={s.fileHead}>
                {i.status === "done" && <CheckmarkCircle16Regular className={s.ok} />}
                {i.status === "refused" && <ErrorCircle16Regular className={s.bad} />}
                <span className={s.fileName}>{i.file.name}</span>
                <Text size={200} className={s.muted}>
                  {i.status === "waiting" ? t("research.addSources.statusWaiting") : i.status === "uploading" ? `${Math.round(i.progress * 100)}%` : i.status === "done" ? t("research.addSources.statusAdded") : t("research.addSources.statusNotAdded")}
                </Text>
              </div>
              {(i.status === "uploading" || i.status === "waiting") && <ProgressBar value={i.progress} aria-label={t("research.addSources.uploadingAria", { name: i.file.name })} />}
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
  const { t } = useI18n();
  const s = useStyles();
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
      setDone(t("research.addSources.urlAdded", { title: source.title }));
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
      className={s.tabForm}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Field className={s.field} label={t("research.addSources.urlLabel")} hint={t("research.addSources.urlHint")}>
        <Input className={s.input} type="url" value={url} onChange={(_, d) => setUrl(d.value)} placeholder="https://example.com/article" maxLength={RESEARCH_LIMITS.urlLength} required />
      </Field>
      <Field className={s.field} label={t("research.addSources.titleOptional")}>
        <Input className={s.input} value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} />
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
        <Button className={s.actionBtn} appearance="primary" type="submit" disabled={busy || url.trim() === ""}>
          {t("research.addSources.addWebsite")}
        </Button>
      </div>
    </form>
  );
}

function TextTab(p: AddSourcesDialogProps) {
  const { t } = useI18n();
  const s = useStyles();
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
      setDone(t("research.addSources.addedTitle", { title: source.title }));
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
      className={s.tabForm}
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <Field className={s.field} label={t("research.addSources.titleRequired")} required>
        <Input className={s.input} value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} />
      </Field>
      <Field className={s.field} label={t("research.addSources.textLabel")} hint={t("research.addSources.textHint", { max: RESEARCH_LIMITS.pastedTextLength.toLocaleString() })} required>
        <Textarea className={s.input} value={text} onChange={(_, d) => setText(d.value)} resize="vertical" rows={8} maxLength={RESEARCH_LIMITS.pastedTextLength} />
      </Field>
      <RadioGroup layout="horizontal" value={format} onChange={(_, d) => setFormat(d.value as "markdown" | "text")} aria-label={t("research.addSources.formatAria")}>
        <Radio value="markdown" label={t("research.addSources.formatMarkdown")} />
        <Radio value="text" label={t("research.addSources.formatPlain")} />
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
        <Button className={s.actionBtn} appearance="primary" type="submit" disabled={busy || title.trim() === "" || text.trim() === ""}>
          {t("research.addSources.addText")}
        </Button>
      </div>
    </form>
  );
}

function ExistingTab(p: AddSourcesDialogProps) {
  const { t } = useI18n();
  const s = useStyles();
  const unused = p.sources.filter((x) => !p.selection.includes(x.id));
  const [picked, setPicked] = useState<string[]>([]);
  if (unused.length === 0) return <Text className={s.muted}>{t("research.addSources.existingAllUsed")}</Text>;
  return (
    <div className={s.existing}>
      <Text size={200} className={s.muted}>
        {t("research.addSources.existingNote")}
      </Text>
      {unused.map((x) => (
        <div key={x.id} className={s.existingRow}>
          <Checkbox checked={picked.includes(x.id)} onChange={(_, d) => setPicked((list) => (d.checked === true ? [...list, x.id] : list.filter((id) => id !== x.id)))} label={x.title} />
          <SourceIcon source={x} />
        </div>
      ))}
      <div>
        <Button
          className={s.actionBtn}
          appearance="primary"
          disabled={picked.length === 0}
          onClick={() => {
            p.onSelect([...p.selection, ...picked]);
            setPicked([]);
          }}
        >
          {t("research.addSources.useInSession")}
        </Button>
      </div>
    </div>
  );
}
