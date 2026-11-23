// A NEW SESSION, of one of two kinds. CHAT / CODING (the default): an empty page with the composer at the bottom, as in
// Claude Code -- the toolbar holds the draft (a repository of either source, or none; its branch; the model and effort;
// the mode) and sending the first message creates the chat with them and opens it. RESEARCH: a workspace of sources
// (new, or one this account has), the model, and an optional first question -- no repository and no GitHub.
import { Avatar, Button, Link, Text, Title2, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { BookOpen20Regular, Code20Regular, Navigation20Regular } from "@fluentui/react-icons";
import type { ResearchSessionDetail } from "@orbit-web/contracts";
import { NewResearchSession } from "../research/NewResearchSession";
import { DEFAULT_CHAT_RUNTIME, DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, effortFor, modelOf, type EffortChoice, type ModeChoice, type ModelChoice, type RepositorySource, type SessionSummary, type Settings, type SourcesStatus } from "@orbit-web/contracts";
import { useState } from "react";
import { settingsHref } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";
import { ApiErrorBar } from "../../components/ApiErrorBar";
import { send } from "../../services/api";
import { uploadImage } from "../../services/images";
import { Composer } from "../composer/Composer";
import { BranchPicker, RepositoryPicker, type RepositoryChoice } from "../composer/RepositoryPicker";
import { catalogOfConnection, ModelCatalogOverride, useModelCatalog } from "../../services/models/ModelCatalog";
import { useConnections } from "../connections/AiConnectionsSection";
import { chatConnectionsOf, newChatConnection } from "../connections/chatConnections";
import { AiPicker, autoModeWith, ModelEffortPicker, ModePicker } from "../composer/RunPickers";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%", height: "100%", minHeight: 0, overflow: "hidden" },
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
  stageTop: { justifyContent: "flex-start", paddingTop: "6vh" },
  kinds: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", width: "100%", maxWidth: "640px", "@media (max-width: 639px)": { gridTemplateColumns: "1fr" } },
  kind: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    textAlign: "left",
    borderRadius: "14px",
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground1,
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    cursor: "pointer",
    minHeight: "44px",
    transitionProperty: "border-color, background-color",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
  kindSelected: { border: `1px solid ${tokens.colorBrandStroke1}`, backgroundColor: tokens.colorSubtleBackgroundSelected },
  kindText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  kindIcon: { flexShrink: 0, color: tokens.colorBrandForeground1, marginTop: "2px" },
  bottomMobile: { paddingTop: "4px", paddingRight: "12px", paddingBottom: "max(10px, var(--orbit-safe-bottom, env(safe-area-inset-bottom)))", paddingLeft: "12px", flexShrink: 0 },
});

export type SessionKind = "coding" | "research";

const KINDS: { kind: SessionKind; titleKey: MessageKey; textKey: MessageKey }[] = [
  { kind: "coding", titleKey: "chat.newSession.kind.coding.title", textKey: "chat.newSession.kind.coding.text" },
  { kind: "research", titleKey: "chat.newSession.kind.research.title", textKey: "chat.newSession.kind.research.text" },
];

// The two kinds of session, as a radio group of two cards.
function KindChooser({ kind, onKind }: { kind: SessionKind; onKind: (k: SessionKind) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <div className={s.kinds} role="radiogroup" aria-label={t("chat.newSession.kindAria")}>
      {KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          role="radio"
          aria-checked={kind === k.kind}
          className={mergeClasses(s.kind, kind === k.kind && s.kindSelected)}
          onClick={() => onKind(k.kind)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") onKind(k.kind === "coding" ? "research" : "coding");
          }}
        >
          {k.kind === "coding" ? <Code20Regular className={s.kindIcon} /> : <BookOpen20Regular className={s.kindIcon} />}
          <span className={s.kindText}>
            <Text weight="semibold">{t(k.titleKey)}</Text>
            <Text size={200} className={s.muted}>
              {t(k.textKey)}
            </Text>
          </span>
        </button>
      ))}
    </div>
  );
}

export function NewSession({
  settings,
  sources,
  onCreated,
  onResearchCreated,
  onConnect,
  onOpenNav,
  userName,
  onOpenAccount,
}: {
  settings: Settings | null;
  sources: SourcesStatus | null;
  onCreated: (s: SessionSummary) => void;
  onResearchCreated?: (s: ResearchSessionDetail) => void;
  onConnect: (source: RepositorySource) => void;
  onOpenNav?: () => void;
  // The signed-in user's full name, on the account button of a narrow screen.
  userName?: string | null;
  onOpenAccount?: () => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const [kind, setKind] = useState<SessionKind>("coding");
  const { isMobile, isCoarse } = useViewport();
  const [choice, setChoice] = useState<RepositoryChoice | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  // A choice a person made wins; until then, Settings' defaults.
  const [model, setModel] = useState<ModelChoice | null>(null);
  const [effort, setEffort] = useState<EffortChoice | null>(null);
  const [mode, setMode] = useState<ModeChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Which connection the chat runs on: one of the account's Claude Code or OpenAI Codex connections, signed in, with
  // models to choose from -- the one a person names, else the one of the AI Settings names (chatConnections.ts).
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const connections = useConnections();
  const chatConnections = chatConnectionsOf(connections.data);
  // No AI signed in at all: nothing of anybody's is offered, nothing is sent -- the way to sign one in instead.
  const noAi = connections.data !== null && chatConnections.length === 0;
  const defaultRuntime = settings?.defaultRuntime ?? DEFAULT_CHAT_RUNTIME;
  const defaultClaude = chatConnections.find((c) => c.runtime === "claude" && c.isDefault) ?? null;
  // The AI the chat runs on: the one chosen, else Settings' default AI. Everything below (the picker, the models
  // offered, what is sent) is this one's: nothing shown without it.
  const effective = chatConnections.find((c) => c.id === connectionId) ?? newChatConnection(chatConnections, defaultRuntime);
  const named = effective !== null && effective.id !== defaultClaude?.id ? effective : null;
  const accountCatalog = useModelCatalog();
  const catalog = named === null ? accountCatalog : catalogOfConnection(named);
  // Settings' default model when the chat runs on Settings' AI, unless this account cannot use it: then the one its CLI
  // recommends. On another AI, that AI's recommended one.
  const preferred = effective === null || effective.runtime === defaultRuntime ? (settings?.defaultModel ?? DEFAULT_MODEL) : catalog.recommended;
  const usable = catalog.source !== "account" || modelOf(catalog, preferred) !== null ? preferred : catalog.recommended;
  const runModel = model ?? usable;
  const preferredEffort = settings?.defaultEffort ?? DEFAULT_EFFORT;
  const run = {
    model: runModel,
    effort: effort ?? (named === null ? preferredEffort : (effortFor(modelOf(catalog, runModel), preferredEffort) ?? preferredEffort)),
    mode: mode ?? settings?.defaultMode ?? DEFAULT_MODE,
  };
  const chooseConnection = (id: string) => {
    setConnectionId(id);
    setModel(null);
    setEffort(null);
  };
  // A model auto mode is not available with plans only.
  const chooseModel = (m: ModelChoice) => {
    setModel(m);
    if (!autoModeWith(catalog, m) && run.mode === "autonomous") setMode("plan");
  };

  const start = async (prompt: string, images: string[]) => {
    setBusy(true);
    setError(null);
    try {
      const repository = choice ? { source: choice.source, id: choice.repository.id } : null;
      const created = await send<SessionSummary>("POST", "/api/sessions", { repository, branch: choice ? (branch ?? choice.repository.defaultBranch) : null, ...(named !== null ? { connectionId: named.id } : {}), ...run, ...(prompt.trim().length > 0 ? { prompt } : {}), ...(images.length > 0 ? { images } : {}) });
      onCreated(created);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const composer = (
    <Composer
      autoFocus={!isMobile && !isCoarse}
      placeholder={t("chat.newSession.placeholder")}
      canSend={!busy && !noAi}
      running={false}
      busy={busy}
      onSend={(text, images) => void start(text, images)}
      onUploadImage={uploadImage}
      commandsPath={choice ? `/api/commands?source=${choice.source}&repository=${encodeURIComponent(choice.repository.id)}` : "/api/commands"}
      above={error !== null && <ApiErrorBar error={error} />}
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
        <ModelCatalogOverride catalog={catalog}>
          {noAi ? (
            <Link href={settingsHref("ai-connections")}>{t("chat.newSession.signInFirst")}</Link>
          ) : (
            <>
              {effective !== null && <AiPicker choices={chatConnections} value={effective.id} onChange={chooseConnection} />}
              <ModelEffortPicker model={run.model} effort={run.effort} onModel={chooseModel} onEffort={setEffort} />
            </>
          )}
          <ModePicker mode={run.mode} onMode={setMode} autoMode={autoModeWith(catalog, run.model)} />
        </ModelCatalogOverride>
      }
    />
  );

  return (
    <section className={s.root} aria-label={t("chat.newSession.sectionAria")}>
      {(onOpenNav || onOpenAccount) && (
        <div className={mergeClasses(s.top, isMobile && s.topMobile)}>
          <div className={s.topLeft}>
            {onOpenNav && <Button className={s.touchBtn} appearance="subtle" icon={<Navigation20Regular />} aria-label={t("chat.screen.openNavAria")} onClick={onOpenNav} />}
            <img src="/orbit.svg" alt="" className={s.topLogo} />
            <Text weight="semibold">{t("chat.newSession.brand")}</Text>
          </div>
          {onOpenAccount && (
            <Button
              className={s.touchBtn}
              appearance="subtle"
              icon={<Avatar name={userName ?? t("chat.newSession.accountFallback")} size={24} />}
              aria-label={t("chat.newSession.accountAria")}
              onClick={onOpenAccount}
            />
          )}
        </div>
      )}
      {kind === "research" ? (
        <div className={mergeClasses(s.stage, s.stageTop, isMobile && s.heroMobile)}>
          <div className={s.hero}>
            <img src="/orbit.svg" alt="" className={s.logo} />
            <Title2 as="h1" className={s.heading}>
              {t("chat.newSession.researchHeading")}
            </Title2>
            <Text className={s.muted}>{t("chat.newSession.researchSub")}</Text>
          </div>
          <KindChooser kind={kind} onKind={setKind} />
          <NewResearchSession settings={settings} onCreated={(created) => onResearchCreated?.(created)} />
        </div>
      ) : isMobile ? (
        <>
          <div className={mergeClasses(s.hero, s.heroMobile)}>
            <img src="/orbit.svg" alt="" className={s.logo} />
            <Title2 as="h1" className={s.heading}>
              {t("chat.newSession.codingHeading")}
            </Title2>
            <Text className={s.muted}>{t("chat.newSession.codingSub")}</Text>
            <KindChooser kind={kind} onKind={setKind} />
          </div>
          <div className={s.bottomMobile}>{composer}</div>
        </>
      ) : (
        <div className={s.stage}>
          <div className={s.hero}>
            <img src="/orbit.svg" alt="" className={s.logo} />
            <Title2 as="h1" className={s.heading}>
              {t("chat.newSession.codingHeading")}
            </Title2>
            <Text className={s.muted}>{t("chat.newSession.codingSub")}</Text>
          </div>
          <KindChooser kind={kind} onKind={setKind} />
          <div className={s.composerDesktop}>{composer}</div>
        </div>
      )}
    </section>
  );
}
