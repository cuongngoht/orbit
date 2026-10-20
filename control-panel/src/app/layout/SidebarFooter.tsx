import type { ReactElement } from "react";
import { Button, Caption1, Text, Menu, MenuItemRadio, MenuList, MenuPopover, MenuTrigger, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import {
  DesktopMac20Regular,
  LockClosed20Regular,
  LockOpen20Regular,
  PlugDisconnected20Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from "@fluentui/react-icons";
import { useQuery } from "@tanstack/react-query";
import { api, mutationToken } from "../../shared/api/client";
import { THEME_CHOICES, useThemeChoice, type ThemeChoice } from "../theme";

interface Health {
  status: "ok";
  node: string;
  engine: string | null;
  skills: number;
}

const THEME_ICONS: Record<ThemeChoice, ReactElement> = {
  system: <DesktopMac20Regular />,
  light: <WeatherSunny20Regular />,
  dark: <WeatherMoon20Regular />,
};

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, width: "100%", paddingBottom: tokens.spacingVerticalS },
  compact: { alignItems: "center" },
  row: { justifyContent: "flex-start", width: "100%", fontWeight: tokens.fontWeightRegular },
  status: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalS,
    minHeight: "32px",
    paddingInline: tokens.spacingHorizontalS,
    borderRadius: tokens.borderRadiusMedium,
    ":focus-visible": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  statusIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "40px",
    height: "32px",
    borderRadius: tokens.borderRadiusMedium,
    ":focus-visible": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}` },
  },
  version: { color: tokens.colorNeutralForeground3, paddingInline: tokens.spacingHorizontalS, fontVariantNumeric: "tabular-nums" },
  warn: { color: "var(--viz-warning)" },
  good: { color: "var(--viz-good)" },
  bad: { color: "var(--viz-critical)" },
});

// Not a button: it states something and does nothing, so it is a status a
// keyboard can still reach for its tooltip.
// What is true about THIS session, in the one place that is visible from every
// page: can I change things here, is the server still there, which theme.
export function SidebarFooter({ compact }: { compact: boolean }) {
  const styles = useStyles();
  return (
    <div className={`${styles.root} ${compact ? styles.compact : ""}`}>
      <Access compact={compact} />
      <ThemeMenu compact={compact} />
      {!compact && <Version />}
    </div>
  );
}

function Access({ compact }: { compact: boolean }) {
  const styles = useStyles();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/api/v1/health"), refetchInterval: 30_000 });
  const state = health.isError
    ? { icon: <PlugDisconnected20Regular className={styles.bad} />, label: "Server unreachable", hint: "The Orbit Control server is not answering. Is it still running?" }
    : mutationToken()
      ? { icon: <LockOpen20Regular className={styles.good} />, label: "Editing enabled", hint: "This tab holds the server's token: skills can be edited and deleted." }
      : { icon: <LockClosed20Regular className={styles.warn} />, label: "Read-only", hint: "This tab has no token. Open the URL the server printed at start-up to edit or delete skills." };
  return (
    <Tooltip content={state.hint} relationship="description" positioning="after">
      <span className={compact ? styles.statusIcon : styles.status} tabIndex={0} role="status" aria-label={compact ? state.label : undefined}>
        {state.icon}
        {!compact && <Text size={300}>{state.label}</Text>}
      </span>
    </Tooltip>
  );
}

function ThemeMenu({ compact }: { compact: boolean }) {
  const styles = useStyles();
  const { choice, setChoice } = useThemeChoice();
  const label = `Theme: ${THEME_CHOICES.find((c) => c.value === choice)?.label}`;
  return (
    <Menu checkedValues={{ theme: [choice] }} onCheckedValueChange={(_, d) => setChoice(d.checkedItems[0] as ThemeChoice)} positioning="after-bottom">
      <MenuTrigger disableButtonEnhancement>
        <Tooltip content={label} relationship="label" positioning="after" visible={compact ? undefined : false}>
          <Button appearance="subtle" icon={THEME_ICONS[choice]} className={compact ? undefined : styles.row}>
            {compact ? undefined : label}
          </Button>
        </Tooltip>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {THEME_CHOICES.map((c) => (
            <MenuItemRadio key={c.value} name="theme" value={c.value} icon={THEME_ICONS[c.value]}>
              {c.label}
            </MenuItemRadio>
          ))}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

function Version() {
  const styles = useStyles();
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<Health>("/api/v1/health") });
  if (!health.data) return null;
  return (
    <Caption1 className={styles.version}>
      engine {health.data.engine ?? "unknown"} · Node {health.data.node}
    </Caption1>
  );
}
