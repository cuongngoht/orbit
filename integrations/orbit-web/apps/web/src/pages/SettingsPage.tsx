// Settings: the two accounts, a person's preferences, and the system checks.
import { Card, CardHeader, Field, MessageBar, MessageBarBody, Select, Switch, Text, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { MODEL_CHOICES, MODEL_LABELS, type ModelChoice, type SetupStatus, type Settings, type ThemePreference } from "@orbit-web/contracts";
import { useState } from "react";
import { ClaudeCard } from "../features/setup/ClaudeCard";
import { GitHubCard } from "../features/setup/GitHubCard";
import { SystemCard } from "../features/setup/SystemCard";
import { errorText, send } from "../services/api";

const useStyles = makeStyles({
  page: { maxWidth: "880px", margin: "0 auto", padding: "24px", display: "flex", flexDirection: "column", gap: "16px", overflowY: "auto", height: "100%", boxSizing: "border-box" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" },
  prefs: { display: "flex", flexDirection: "column", gap: "12px" },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function SettingsPage({ status, settings, reloadStatus, onSettings }: { status: SetupStatus | null; settings: Settings | null; reloadStatus: () => void; onSettings: (s: Settings) => void }) {
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);
  const save = async (change: Partial<Pick<Settings, "defaultModel" | "webTools" | "theme">>) => {
    setError(null);
    try {
      onSettings(await send<Settings>("PATCH", "/api/settings", change));
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <div className={s.page}>
      <Title2>Settings</Title2>
      <div className={s.grid}>
        <ClaudeCard status={status?.claude ?? null} onChanged={reloadStatus} />
        <GitHubCard status={status?.github ?? null} onChanged={reloadStatus} />
      </div>
      {settings && (
        <Card aria-label="Preferences">
          <CardHeader header={<Text weight="semibold">Preferences</Text>} />
          <div className={s.prefs}>
            <Field label="Default Claude model">
              <Select value={settings.defaultModel} onChange={(_, d) => void save({ defaultModel: d.value as ModelChoice })}>
                {MODEL_CHOICES.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Theme">
              <Select value={settings.theme} onChange={(_, d) => void save({ theme: d.value as ThemePreference })}>
                <option value="system">Follow the system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </Select>
            </Field>
            <Switch checked={settings.webTools} onChange={(_, d) => void save({ webTools: d.checked })} label="Let Claude use the web tools (WebFetch, WebSearch)" />
            <Text size={200} className={s.muted}>
              {settings.maxBudgetUsd !== null ? `Each run is capped at $${settings.maxBudgetUsd} (ORBIT_WEB_MAX_BUDGET_USD).` : "No per-run budget cap is set (ORBIT_WEB_MAX_BUDGET_USD)."}
            </Text>
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </div>
        </Card>
      )}
      <SystemCard status={status} />
    </div>
  );
}
