// SETTINGS → APPEARANCE and CODE: the theme; how a new chat runs by default (its AI, then that AI's model, effort and
// mode -- or, with no AI signed in, the way to sign one in), what a repository
// brings to its chats (its skills, as instructions; its plugins, which run code) and the tools Claude is offered. Each
// change is saved at once (`PATCH /api/settings`) and the answer is the settings as they are now.
import { Field, Link, MessageBar, MessageBarBody, Radio, RadioGroup, Switch, Text, makeStyles, shorthands, tokens, type FieldControlProps } from "@fluentui/react-components";
import { ChevronDown20Regular } from "@fluentui/react-icons";
import {
  EFFORT_CHOICES,
  effortFor,
  effortLabel,
  MODE_CHOICES,
  MODE_LABELS,
  modelLabel,
  modelOf,
  RUNTIME_LABELS,
  type AiConnectionsView,
  type ChatRuntime,
  type EffortChoice,
  type ModeChoice,
  type ModelChoice,
  type Settings,
  type ThemePreference,
  type UpdateSettingsRequest,
} from "@orbit-web/contracts";
import { useState, type ReactNode } from "react";
import { ConnectionRequired } from "../../components/ApiErrorBar";
import { settingsHref } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { errorText, send } from "../../services/api";
import { catalogOfConnection } from "../../services/models/ModelCatalog";
import { useConnections } from "../connections/AiConnectionsSection";
import { chatConnectionsOf, newChatConnection, signedInRuntimes, unsignedRuntimes, type ChatConnection } from "../connections/chatConnections";
import { MODE_HINTS } from "../composer/RunPickers";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "22px", maxWidth: "640px", "& .fui-Radio, & .fui-Switch": { "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" } } },
  group: { display: "flex", flexDirection: "column", gap: "10px" },
  muted: { color: tokens.colorNeutralForeground3 },
  warn: { color: tokens.colorPaletteMarigoldForeground2 },
  selectWrap: {
    position: "relative",
    width: "100%",
    minHeight: "34px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" },
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    borderBottomColor: tokens.colorNeutralStrokeAccessible,
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      borderBottomColor: tokens.colorNeutralStrokeAccessible,
    },
    ":focus-within": {
      ...shorthands.borderColor(tokens.colorCompoundBrandStroke),
      outlineWidth: "1px",
      outlineStyle: "solid",
      outlineColor: tokens.colorCompoundBrandStroke,
    },
  },
  selectFace: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    width: "100%",
    minHeight: "inherit",
    paddingTop: "6px",
    paddingRight: "10px",
    paddingBottom: "6px",
    paddingLeft: "12px",
    pointerEvents: "none",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    "@media (max-width: 639px)": { fontSize: "15px" },
  },
  selectValue: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  selectCaret: { flexShrink: 0, color: tokens.colorNeutralStrokeAccessible },
  selectOverlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    opacity: 0,
    cursor: "pointer",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    border: "none",
    zIndex: 1,
  },
});

function SingleCaretSelect({
  fieldProps,
  value,
  displayText,
  onChange,
  children,
}: {
  fieldProps: FieldControlProps;
  value: string;
  displayText: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const s = useStyles();
  return (
    <div className={s.selectWrap}>
      <div className={s.selectFace} aria-hidden>
        <span className={s.selectValue}>{displayText}</span>
        <ChevronDown20Regular className={s.selectCaret} />
      </div>
      <select {...fieldProps} className={s.selectOverlay} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

interface SectionProps {
  settings: Settings;
  onSettings: (s: Settings) => void;
}

// One preference changed at a time and saved at once; a refusal is said, and nothing else changes.
function useSave(onSettings: (s: Settings) => void) {
  const [error, setError] = useState<string | null>(null);
  const save = async (change: UpdateSettingsRequest) => {
    setError(null);
    try {
      onSettings(await send<Settings>("PATCH", "/api/settings", change));
    } catch (err) {
      setError(errorText(err));
    }
  };
  return { error, save };
}

function SaveError({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <MessageBar intent="error">
      <MessageBarBody>{error}</MessageBarBody>
    </MessageBar>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const s = useStyles();
  return (
    <section className={s.group} aria-label={title}>
      <Text weight="semibold">{title}</Text>
      {children}
    </section>
  );
}

export function AppearanceSection({ settings, onSettings }: SectionProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { error, save } = useSave(onSettings);
  return (
    <div className={s.root}>
      <Field label={t("settings.prefs.theme")}>
        <RadioGroup value={settings.theme} onChange={(_, d) => void save({ theme: d.value as ThemePreference })}>
          <Radio value="system" label={t("settings.prefs.theme.system")} />
          <Radio value="light" label={t("settings.prefs.theme.light")} />
          <Radio value="dark" label={t("settings.prefs.theme.dark")} />
        </RadioGroup>
      </Field>
      <SaveError error={error} />
    </div>
  );
}

// A new chat's defaults, in the order a chat chooses them: the AI first -- one the account signed in -- then a model of
// that AI's own, its effort, and the mode. With no AI signed in there is nothing of anybody's to offer: the way to sign
// one in instead (Settings → AI Connections).
function NewChatDefaults({ settings, view, failed, save }: { settings: Settings; view: AiConnectionsView | null; failed: string | null; save: (change: UpdateSettingsRequest) => Promise<void> }) {
  const { t } = useI18n();
  const s = useStyles();
  if (view === null) return <Text size={200} className={s.muted}>{failed === null ? t("settings.prefs.connectionsLoading") : t("settings.prefs.connectionsFailed", { error: failed })}</Text>;
  const chat = chatConnectionsOf(view);
  const ai = newChatConnection(chat, settings.defaultRuntime);
  if (ai === null) return <ConnectionRequired what={t("settings.prefs.connectionsRequired")} />;
  return <AiDefaults settings={settings} chat={chat} ai={ai} save={save} />;
}

function AiDefaults({ settings, chat, ai, save }: { settings: Settings; chat: ChatConnection[]; ai: ChatConnection; save: (change: UpdateSettingsRequest) => Promise<void> }) {
  const { t } = useI18n();
  const s = useStyles();
  const catalog = catalogOfConnection(ai);
  // The model kept is this AI's only when Settings names this AI; else the one this AI recommends.
  const model = settings.defaultRuntime === ai.runtime && (modelOf(catalog, settings.defaultModel) !== null || catalog.source !== "account") ? settings.defaultModel : catalog.recommended;
  const models = catalog.models.some((m) => m.id === model) ? catalog.models : [...catalog.models, { id: model, label: modelLabel(model, catalog) }];
  const efforts = modelOf(catalog, model)?.efforts ?? [...EFFORT_CHOICES];
  const effort = effortFor(modelOf(catalog, model), settings.defaultEffort) ?? settings.defaultEffort;
  const effortText = (e: EffortChoice) => (e === "medium" ? t("settings.prefs.effortRecommended", { label: effortLabel(e) }) : effortLabel(e));
  // A model, an effort or a mode is the AI's it was chosen on: it is saved with that AI.
  const run = (change: UpdateSettingsRequest) => void save({ defaultRuntime: ai.runtime, ...change });
  return (
    <>
      <Field label={t("settings.prefs.defaultAi")}>
        {(fieldProps) => (
          <SingleCaretSelect fieldProps={fieldProps} value={ai.runtime} displayText={RUNTIME_LABELS[ai.runtime]} onChange={(value) => void save({ defaultRuntime: value as ChatRuntime })}>
            {signedInRuntimes(chat).map((r) => (
              <option key={r} value={r}>
                {RUNTIME_LABELS[r]}
              </option>
            ))}
          </SingleCaretSelect>
        )}
      </Field>
      {unsignedRuntimes(chat).map((r) => (
        <Text key={r} size={200} className={s.muted}>
          {t("settings.prefs.unsignedBefore", { label: RUNTIME_LABELS[r] })} <Link href={settingsHref("ai-connections")}>{t("settings.prefs.unsignedLink")}</Link> {t("settings.prefs.unsignedAfter")}
        </Text>
      ))}
      <Field label={t("settings.prefs.defaultModel")}>
        {(fieldProps) => (
          <SingleCaretSelect fieldProps={fieldProps} value={model} displayText={modelLabel(model, catalog)} onChange={(value) => run({ defaultModel: value as ModelChoice })}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </SingleCaretSelect>
        )}
      </Field>
      <Field label={t("settings.prefs.defaultEffort")} hint={t("settings.prefs.defaultEffortHint")}>
        {(fieldProps) => (
          <SingleCaretSelect fieldProps={fieldProps} value={effort} displayText={efforts.length === 0 ? t("settings.prefs.noEffortLevel") : effortText(effort)} onChange={(value) => run({ defaultEffort: value as EffortChoice })}>
            {efforts.map((e) => (
              <option key={e} value={e}>
                {effortText(e)}
              </option>
            ))}
          </SingleCaretSelect>
        )}
      </Field>
      <Field label={t("settings.prefs.defaultMode")}>
        <RadioGroup value={settings.defaultMode} onChange={(_, d) => run({ defaultMode: d.value as ModeChoice })}>
          {MODE_CHOICES.map((m) => (
            <Radio key={m} value={m} label={t("settings.prefs.modeRow", { mode: MODE_LABELS[m], hint: MODE_HINTS[m] })} />
          ))}
        </RadioGroup>
      </Field>
    </>
  );
}

export function CodeSection({ settings, onSettings }: SectionProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { error, save } = useSave(onSettings);
  const connections = useConnections();
  return (
    <div className={s.root}>
      <Group title={t("settings.prefs.group.newChat")}>
        <Text size={200} className={s.muted}>
          {t("settings.prefs.group.newChatHint")}
        </Text>
        <NewChatDefaults settings={settings} view={connections.data} failed={connections.error} save={save} />
      </Group>
      <Group title={t("settings.prefs.group.repo")}>
        <Switch checked={settings.projectSkills} onChange={(_, d) => void save({ projectSkills: d.checked })} label={t("settings.prefs.projectSkills")} />
        <Text size={200} className={s.muted}>
          {t("settings.prefs.projectSkillsHint")}
        </Text>
        <Switch checked={settings.projectPlugins} onChange={(_, d) => void save({ projectPlugins: d.checked })} label={t("settings.prefs.projectPlugins")} />
        <Text size={200} className={s.warn}>
          {t("settings.prefs.projectPluginsWarn")}
        </Text>
      </Group>
      <Group title={t("settings.prefs.group.tools")}>
        <Switch checked={settings.webTools} onChange={(_, d) => void save({ webTools: d.checked })} label={t("settings.prefs.webTools")} />
        <Text size={200} className={s.muted}>
          {settings.maxBudgetUsd !== null ? t("settings.prefs.budgetCapped", { amount: settings.maxBudgetUsd }) : t("settings.prefs.budgetUncapped")}
        </Text>
      </Group>
      <SaveError error={error} />
    </div>
  );
}
