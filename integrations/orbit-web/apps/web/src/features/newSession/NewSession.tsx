// A NEW SESSION: an empty page with the composer at the bottom, as in Claude Code. The toolbar holds the draft -- a
// repository of either source (or none), its branch, the model and effort, the mode -- and sending the first message
// creates the chat with them and opens it.
import { MessageBar, MessageBarBody, Text, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, type EffortChoice, type ModeChoice, type ModelChoice, type RepositorySource, type SessionSummary, type Settings, type SourcesStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { errorText, send } from "../../services/api";
import { Composer } from "../composer/Composer";
import { BranchPicker, RepositoryPicker, type RepositoryChoice } from "../composer/RepositoryPicker";
import { ModelEffortPicker, ModePicker } from "../composer/RunPickers";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  top: { padding: "14px 20px", color: tokens.colorNeutralForeground3 },
  hero: { flexGrow: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", padding: "24px", textAlign: "center" },
  logo: { width: "44px", height: "44px", opacity: 0.9 },
  muted: { color: tokens.colorNeutralForeground3, maxWidth: "520px" },
  bottom: { padding: "0 20px 20px" },
});

export function NewSession({ settings, sources, onCreated, onConnect }: { settings: Settings | null; sources: SourcesStatus | null; onCreated: (s: SessionSummary) => void; onConnect: (source: RepositorySource) => void }) {
  const s = useStyles();
  const [choice, setChoice] = useState<RepositoryChoice | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  // A choice a person made wins; until then, Settings' defaults.
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [effort, setEffort] = useState<EffortChoice | null>(null);
  const [mode, setMode] = useState<ModeChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = {
    model: model ?? settings?.defaultModel ?? DEFAULT_MODEL,
    effort: effort ?? settings?.defaultEffort ?? DEFAULT_EFFORT,
    mode: mode ?? settings?.defaultMode ?? DEFAULT_MODE,
  };

  const start = async (prompt: string) => {
    setBusy(true);
    setError(null);
    try {
      const repository = choice ? { source: choice.source, id: choice.repository.id } : null;
      const created = await send<SessionSummary>("POST", "/api/sessions", { repository, branch: choice ? (branch ?? choice.repository.defaultBranch) : null, ...run, prompt });
      onCreated(created);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.root} aria-label="New session">
      <div className={s.top}>
        <Text weight="semibold">New session</Text>
      </div>
      <div className={s.hero}>
        <img src="/orbit.svg" alt="" className={s.logo} />
        <Title2 as="h1">What should Orbit work on?</Title2>
        <Text className={s.muted}>Describe a task or ask a question. Start from a repository on GitHub or Azure DevOps — or from none, in an empty workspace of its own.</Text>
      </div>
      <div className={s.bottom}>
        <Composer
          autoFocus
          placeholder="Describe a task or ask a question"
          canSend={!busy}
          running={false}
          busy={busy}
          onSend={(text) => void start(text)}
          commandsPath={choice ? `/api/commands?source=${choice.source}&repository=${encodeURIComponent(choice.repository.id)}` : "/api/commands"}
          above={
            error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )
          }
          left={
            <>
              <RepositoryPicker
                value={choice}
                sources={sources}
                onConnect={onConnect}
                onChange={(c) => {
                  setChoice(c);
                  setBranch(c?.repository.defaultBranch ?? null);
                }}
              />
              {choice && <BranchPicker choice={choice} value={branch} onChange={setBranch} />}
            </>
          }
          right={
            <>
              <ModelEffortPicker model={run.model} effort={run.effort} onModel={setModel} onEffort={setEffort} />
              <ModePicker mode={run.mode} onMode={setMode} />
            </>
          }
        />
      </div>
    </section>
  );
}
