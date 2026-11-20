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
  top: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", minHeight: "52px", paddingTop: "10px", paddingRight: "16px", paddingBottom: "10px", paddingLeft: "16px", color: tokens.colorNeutralForeground2 },
  topMobile: { paddingTop: "max(8px, env(safe-area-inset-top))", paddingRight: "10px", paddingBottom: "6px", paddingLeft: "8px" },
  topLeft: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0 },
  topLogo: { width: "24px", height: "24px" },
  touchBtn: { minWidth: "44px", minHeight: "44px" },
  stage: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "28px",
    paddingTop: "24px",
    paddingRight: "24px",
    paddingBottom: "10dvh",
    paddingLeft: "24px",
  },
  hero: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px", textAlign: "center" },
  heroMobile: { flexGrow: 1, minHeight: 0, overflowY: "auto", paddingTop: "16px", paddingRight: "20px", paddingBottom: "16px", paddingLeft: "20px" },
  logo: { width: "54px", height: "54px" },
  heading: { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, fontSize: "clamp(24px, 6vw, 32px)", lineHeight: "1.2", letterSpacing: "-0.025em", fontWeight: tokens.fontWeightSemibold },
  muted: { color: tokens.colorNeutralForeground3, maxWidth: "460px", lineHeight: "1.55" },
  composerDesktop: { width: "100%", maxWidth: "760px" },
  bottomMobile: { paddingTop: "4px", paddingRight: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))", paddingLeft: "12px", flexShrink: 0 },
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

  const composer = (
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
  );

  return (
    <section className={s.root} aria-label="New session">
      {(onOpenNav || onOpenAccount) && (
        <div className={mergeClasses(s.top, isMobile && s.topMobile)}>
          <div className={s.topLeft}>
            {onOpenNav && <Button className={s.touchBtn} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
            <img src="/orbit.svg" alt="" className={s.topLogo} />
            <Text weight="semibold">Orbit</Text>
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
      )}
      {isMobile ? (
        <>
          <div className={mergeClasses(s.hero, s.heroMobile)}>
            <img src="/orbit.svg" alt="" className={s.logo} />
            <Title2 as="h1" className={s.heading}>
              What should Orbit work on?
            </Title2>
            <Text className={s.muted}>Describe a task or ask a question. Start from a repository on GitHub or Azure DevOps — or from none, in an empty workspace of its own.</Text>
          </div>
          <div className={s.bottomMobile}>{composer}</div>
        </>
      ) : (
        <div className={s.stage}>
          <div className={s.hero}>
            <img src="/orbit.svg" alt="" className={s.logo} />
            <Title2 as="h1" className={s.heading}>
              What should Orbit work on?
            </Title2>
            <Text className={s.muted}>Describe a task or ask a question. Start from a repository on GitHub or Azure DevOps — or from none, in an empty workspace of its own.</Text>
          </div>
          <div className={s.composerDesktop}>{composer}</div>
        </div>
      )}
    </section>
  );
}
