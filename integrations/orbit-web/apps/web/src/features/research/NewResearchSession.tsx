// A NEW RESEARCH SESSION: in a new research workspace (named here) or one this account already has, with the model and
// effort its account may use, and -- if wanted -- a first question, asked as soon as a selected source is ready. No
// repository, no branch and no GitHub: research needs none of them.
import { Button, Dropdown, Field, Input, Option, Radio, RadioGroup, Spinner, Text, Textarea, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ShieldCheckmark16Regular } from "@fluentui/react-icons";
import { DEFAULT_EFFORT, DEFAULT_MODEL, modelOf, RESEARCH_LIMITS, type ResearchSessionDetail, type ResearchWorkspaceSummary, type Settings } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { ApiErrorBar } from "../../components/ApiErrorBar";
import { useModelCatalog } from "../../services/models/ModelCatalog";
import { ModelEffortPicker } from "../composer/RunPickers";
import { research } from "./api";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", gap: "16px", width: "100%", maxWidth: "640px", textAlign: "left", minWidth: 0 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    borderRadius: "20px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    paddingTop: "20px",
    paddingRight: "20px",
    paddingBottom: "20px",
    paddingLeft: "20px",
    minWidth: 0,
  },
  field: { minWidth: 0, width: "100%", maxWidth: "100%" },
  control: { minWidth: 0, width: "100%", maxWidth: "100%" },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    paddingTop: "4px",
  },
  privacy: { display: "flex", alignItems: "flex-start", gap: "6px", flexGrow: 1, flexBasis: "260px", color: tokens.colorNeutralForeground3 },
  privacyIcon: { flexShrink: 0, marginTop: "2px" },
  start: { borderRadius: "10px", minHeight: "36px", flexShrink: 0 },
});

export function NewResearchSession({ settings, onCreated }: { settings: Settings | null; onCreated: (session: ResearchSessionDetail) => void }) {
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const workspaces = useResource<ResearchWorkspaceSummary[]>(() => research.workspaces(), []);
  const catalog = useModelCatalog();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [existing, setExisting] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const preferred = settings?.defaultModel ?? DEFAULT_MODEL;
  const run = { model: model ?? (catalog.source !== "account" || modelOf(catalog, preferred) !== null ? preferred : catalog.recommended), effort: effort ?? settings?.defaultEffort ?? DEFAULT_EFFORT };
  const list = workspaces.data ?? [];
  const chosen = mode === "existing" ? (existing ?? list[0]?.id ?? null) : null;
  const ready = mode === "new" ? name.trim().length > 0 : chosen !== null;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const workspaceId = mode === "new" ? (await research.createWorkspace(name.trim(), description.trim())).id : (chosen as string);
      const session = await research.createSession(workspaceId, { model: run.model, effort: run.effort, ...(question.trim() ? { question: question.trim() } : {}) });
      onCreated(session);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={s.form}
      aria-label="New research session"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      <div className={s.card}>
        <RadioGroup value={mode} onChange={(_, d) => setMode(d.value as "new" | "existing")} layout={isMobile ? "vertical" : "horizontal"} aria-label="Research workspace">
          <Radio value="new" label="Create a new research workspace" />
          <Radio value="existing" label="Use an existing one" disabled={list.length === 0} />
        </RadioGroup>
        {mode === "new" ? (
          <>
            <Field className={s.field} label="Workspace name" required>
              <Input className={s.control} value={name} onChange={(_, d) => setName(d.value)} placeholder="AI Governance Research" maxLength={RESEARCH_LIMITS.nameLength} autoFocus={!isMobile && !isCoarse} />
            </Field>
            <Field className={s.field} label="Description (optional)">
              <Input className={s.control} value={description} onChange={(_, d) => setDescription(d.value)} maxLength={RESEARCH_LIMITS.descriptionLength} />
            </Field>
          </>
        ) : workspaces.loading && workspaces.data === null ? (
          <Spinner size="tiny" />
        ) : (
          <Field className={s.field} label="Workspace">
            <Dropdown
              className={s.control}
              value={list.find((w) => w.id === chosen)?.name ?? ""}
              selectedOptions={chosen ? [chosen] : []}
              onOptionSelect={(_, d) => setExisting(d.optionValue ?? null)}
              aria-label="Research workspace"
            >
              {list.map((w) => (
                <Option key={w.id} value={w.id} text={w.name}>
                  {w.name} · {w.sourceCount} source{w.sourceCount === 1 ? "" : "s"}
                  {w.access === "shared" ? ` · shared by ${w.owner}` : ""}
                </Option>
              ))}
            </Dropdown>
          </Field>
        )}
        <div className={s.row}>
          <Text size={200} className={s.muted}>
            Model
          </Text>
          <ModelEffortPicker model={run.model} effort={run.effort} onModel={setModel} onEffort={setEffort} />
        </div>
        <Field className={s.field} label="First question (optional)" hint="Asked at once when a selected source is ready. In a new workspace it waits for you: add sources, then ask it.">
          <Textarea className={s.control} value={question} onChange={(_, d) => setQuestion(d.value)} rows={3} resize="vertical" maxLength={RESEARCH_LIMITS.questionLength} placeholder="What do these sources say about…" />
        </Field>
        <ApiErrorBar error={error} />
        <div className={s.footer}>
          <div className={s.privacy}>
            <ShieldCheckmark16Regular className={s.privacyIcon} aria-hidden />
            <Text size={200}>
              Sources are stored on this Orbit server. When you ask, the passages retrieved from the sources you select are sent to Claude (Anthropic) to answer.
            </Text>
          </div>
          <Button className={s.start} appearance="primary" type="submit" disabled={!ready || busy}>
            {busy ? "Starting…" : "Start research"}
          </Button>
        </div>
      </div>
    </form>
  );
}
