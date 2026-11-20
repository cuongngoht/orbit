// SETTINGS → APPEARANCE and CODE: the theme; how a new chat runs by default (model, effort, mode), what a repository
// brings to its chats (its skills, as instructions; its plugins, which run code) and the tools Claude is offered. Each
// change is saved at once (`PATCH /api/settings`) and the answer is the settings as they are now.
import { Field, MessageBar, MessageBarBody, Radio, RadioGroup, Select, Switch, Text, makeStyles, tokens } from "@fluentui/react-components";
import {
  EFFORT_CHOICES,
  EFFORT_LABELS,
  MODE_CHOICES,
  MODE_LABELS,
  MODEL_CHOICES,
  MODEL_LABELS,
  type EffortChoice,
  type ModeChoice,
  type ModelChoice,
  type Settings,
  type ThemePreference,
  type UpdateSettingsRequest,
} from "@orbit-web/contracts";
import { useState, type ReactNode } from "react";
import { errorText, send } from "../../services/api";
import { MODE_HINTS } from "../composer/RunPickers";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "22px", maxWidth: "640px" },
  group: { display: "flex", flexDirection: "column", gap: "10px" },
  muted: { color: tokens.colorNeutralForeground3 },
  warn: { color: tokens.colorPaletteMarigoldForeground2 },
});

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
  const s = useStyles();
  const { error, save } = useSave(onSettings);
  return (
    <div className={s.root}>
      <Field label="Theme">
        <RadioGroup value={settings.theme} onChange={(_, d) => void save({ theme: d.value as ThemePreference })}>
          <Radio value="system" label="Follow the system" />
          <Radio value="light" label="Light" />
          <Radio value="dark" label="Dark" />
        </RadioGroup>
      </Field>
      <SaveError error={error} />
    </div>
  );
}

export function CodeSection({ settings, onSettings }: SectionProps) {
  const s = useStyles();
  const { error, save } = useSave(onSettings);
  return (
    <div className={s.root}>
      <Group title="A new chat">
        <Text size={200} className={s.muted}>
          What a new chat starts with. A chat's own pickers change it for that chat, from its next message.
        </Text>
        <Field label="Default model">
          <Select value={settings.defaultModel} onChange={(_, d) => void save({ defaultModel: d.value as ModelChoice })}>
            {MODEL_CHOICES.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default effort" hint="Higher effort means more thorough responses, but takes longer and uses your limits faster.">
          <Select value={settings.defaultEffort} onChange={(_, d) => void save({ defaultEffort: d.value as EffortChoice })}>
            {EFFORT_CHOICES.map((e) => (
              <option key={e} value={e}>
                {e === "medium" ? `${EFFORT_LABELS[e]} (recommended)` : EFFORT_LABELS[e]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Default mode">
          <RadioGroup value={settings.defaultMode} onChange={(_, d) => void save({ defaultMode: d.value as ModeChoice })}>
            {MODE_CHOICES.map((m) => (
              <Radio key={m} value={m} label={`${MODE_LABELS[m]} — ${MODE_HINTS[m]}`} />
            ))}
          </RadioGroup>
        </Field>
      </Group>
      <Group title="What a repository brings">
        <Switch checked={settings.projectSkills} onChange={(_, d) => void save({ projectSkills: d.checked })} label="Load project skills" />
        <Text size={200} className={s.muted}>
          On a repository's first fetch, its skills, commands and agents are loaded for that chat as instructions only: their hooks, allowed tools and pre-run commands are removed.
        </Text>
        <Switch checked={settings.projectPlugins} onChange={(_, d) => void save({ projectPlugins: d.checked })} label="Run project plugins" />
        <Text size={200} className={s.warn}>
          A plugin a repository is, or declares, runs code — hooks at session start, MCP servers — in this container, where your sign-ins are. Turn this on only for repositories you trust.
        </Text>
      </Group>
      <Group title="Tools">
        <Switch checked={settings.webTools} onChange={(_, d) => void save({ webTools: d.checked })} label="Let Claude use the web tools (WebFetch, WebSearch)" />
        <Text size={200} className={s.muted}>
          {settings.maxBudgetUsd !== null ? `Each run is capped at $${settings.maxBudgetUsd} (ORBIT_WEB_MAX_BUDGET_USD).` : "No per-run budget cap is set (ORBIT_WEB_MAX_BUDGET_USD)."}
        </Text>
      </Group>
      <SaveError error={error} />
    </div>
  );
}
