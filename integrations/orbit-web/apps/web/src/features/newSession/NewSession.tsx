// A NEW SESSION: an empty page with the composer at the bottom, as in Claude Code. The toolbar holds the draft -- a
// repository of either source (or none), its branch, the model and effort, the mode -- and sending the first message
// creates the chat with them and opens it.
import { Avatar, Button, MessageBar, MessageBarBody, Text, Title2, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Navigation20Regular } from "@fluentui/react-icons";
import { DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, type ClaudeAccount, type EffortChoice, type ModeChoice, type ModelChoice, type RepositorySource, type SessionSummary, type Settings, type SourcesStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { errorText, send } from "../../services/api";
import { Composer } from "../composer/Composer";
import { BranchPicker, RepositoryPicker, type RepositoryChoice } from "../composer/RepositoryPicker";
import { ModelEffortPicker, ModePicker } from "../composer/RunPickers";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 },
  top: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minHeight: "52px", paddingTop: "14px", paddingRight: "20px", paddingBottom: "14px", paddingLeft: "20px", color: tokens.colorNeutralForeground3 },
  topMobile: { paddingTop: "max(8px, env(safe-area-inset-top))", paddingRight: "12px", paddingBottom: "8px", paddingLeft: "12px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  topLeft: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
  touchBtn: { minWidth: "44px", minHeight: "44px" },
  hero: { flexGrow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", paddingTop: "24px", paddingRight: "24px", paddingBottom: "24px", paddingLeft: "24px", textAlign: "center" },
  heroMobile: { paddingTop: "16px", paddingRight: "16px", paddingBottom: "16px", paddingLeft: "16px" },
  logo: { width: "44px", height: "44px", opacity: 0.9 },
  heading: { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, fontSize: "clamp(22px, 5.5vw, 28px)", lineHeight: "1.25" },
  muted: { color: tokens.colorNeutralForeground3, maxWidth: "520px" },
  bottom: { paddingTop: "0", paddingRight: "20px", paddingBottom: "20px", paddingLeft: "20px", flexShrink: 0 },
  bottomMobile: { paddingTop: "0", paddingRight: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))", paddingLeft: "12px" },
});

export function NewSession({
  settings,
  sources,
  onCreated,
  onConnect,
  onOpenNav,
  account,
  onOpenAccount,
}: {
  settings: Settings | null;
  sources: SourcesStatus | null;
  onCreated: (s: SessionSummary) => void;
  onConnect: (source: RepositorySource) => void;
  onOpenNav?: () => void;
  account?: ClaudeAccount | null;
  onOpenAccount?: () => void;
}) {
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
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
      <div className={mergeClasses(s.top, isMobile && s.topMobile)}>
        <div className={s.topLeft}>
          {onOpenNav && <Button className={s.touchBtn} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
          <Text weight="semibold">New session</Text>
        </div>
        {onOpenAccount && (
          <Button
            className={s.touchBtn}
            appearance="subtle"
            icon={<Avatar name={account?.email ?? "Claude account"} size={24} />}
            aria-label="Account and settings"
            onClick={onOpenAccount}
          />
        )}
      </div>
      <div className={mergeClasses(s.hero, isMobile && s.heroMobile)}>
        <img src="/orbit.svg" alt="" className={s.logo} />
        <Title2 as="h1" className={s.heading}>
          What should Orbit work on?
        </Title2>
        <Text className={s.muted}>Describe a task or ask a question. Start from a repository on GitHub or Azure DevOps — or from none, in an empty workspace of its own.</Text>
      </div>
      <div className={mergeClasses(s.bottom, isMobile && s.bottomMobile)}>
        <Composer
          autoFocus={!isMobile && !isCoarse}
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
