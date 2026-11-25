// LIVE OFFICE PULSE: lightweight, opt-in expandable activity ribbon driven by real roster transitions and `office.changed`
// SSE events. Clicking any event focuses the employee on the floor or opens their mission; optional sound chime alerts
// only when a teammate newly transitions into needing owner review or input.
import { Link, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { EmployeeCard } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { useI18n, type I18nContextValue } from "../../i18n";
import { useAppEvent } from "../../services/events/AppEvents";
import { playNotificationChime } from "./floorPrefs";

export interface PulseEvent {
  id: string;
  at: string;
  text: string;
  tone: "brand" | "warning" | "success" | "neutral";
  employeeId?: string;
  missionId?: string;
}

const MAX_EVENTS = 8;

const timeText = (iso: string): string => {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

function diffEmployees(
  prev: Map<string, EmployeeCard>,
  next: EmployeeCard[],
  t: I18nContextValue["t"],
): { added: PulseEvent[]; shouldChime: boolean } {
  const added: PulseEvent[] = [];
  let shouldChime = false;
  for (const e of next) {
    const old = prev.get(e.id);
    if (!old) continue;
    if (old.workLabel === e.workLabel && old.holding?.missionId === e.holding?.missionId) continue;
    const id = `pulse-${e.id}-${e.version}-${e.workLabel}`;
    if (e.workLabel === "waiting_review") {
      added.push({
        id,
        at: e.updatedAt,
        text: t("office.floor.pulseWaitingReview", { name: e.name }),
        tone: "warning",
        employeeId: e.id,
        missionId: e.holding?.missionId,
      });
      shouldChime = true;
    } else if (e.workLabel === "waiting_info") {
      added.push({
        id,
        at: e.updatedAt,
        text: t("office.floor.pulseWaitingInfo", { name: e.name }),
        tone: "warning",
        employeeId: e.id,
        missionId: e.holding?.missionId,
      });
      shouldChime = true;
    } else if (e.workLabel === "working" && e.holding) {
      added.push({
        id,
        at: e.updatedAt,
        text: t("office.floor.pulseStartedWork", { name: e.name, title: e.holding.title }),
        tone: "brand",
        employeeId: e.id,
        missionId: e.holding.missionId,
      });
    } else if (e.workLabel === "ready" && old.workLabel !== "ready") {
      added.push({
        id,
        at: e.updatedAt,
        text: t("office.floor.pulseReady", { name: e.name }),
        tone: "success",
        employeeId: e.id,
      });
    }
  }
  return { added, shouldChime };
}

export function useOfficePulse(employees: EmployeeCard[], soundEnabled: boolean) {
  const { t } = useI18n();
  const [prevEmployees, setPrevEmployees] = useState(employees);
  const [events, setEvents] = useState<PulseEvent[]>([]);
  const [chimeSeq, setChimeSeq] = useState(0);
  const lastChimedRef = useRef(0);
  const sseSeqRef = useRef(0);

  if (prevEmployees !== employees) {
    const prevMap = new Map(prevEmployees.map((e) => [e.id, e]));
    const { added, shouldChime } = diffEmployees(prevMap, employees, t);
    setPrevEmployees(employees);
    if (added.length > 0) {
      setEvents((cur) => [...added, ...cur].slice(0, MAX_EVENTS));
      if (shouldChime) setChimeSeq((n) => n + 1);
    }
  }

  useEffect(() => {
    if (chimeSeq > lastChimedRef.current) {
      lastChimedRef.current = chimeSeq;
      if (soundEnabled) playNotificationChime();
    }
  }, [chimeSeq, soundEnabled]);

  useAppEvent("office.changed", () => {
    sseSeqRef.current += 1;
    const nowIso = new Date().toISOString();
    setEvents((cur) => {
      if (cur[0]?.tone === "neutral" && Date.now() - Date.parse(cur[0].at) < 4000) return cur;
      return [{ id: `sse-${sseSeqRef.current}`, at: nowIso, text: t("office.floor.pulseRosterUpdated"), tone: "neutral" as const }, ...cur].slice(0, MAX_EVENTS);
    });
  });

  return events;
}

const useStyles = makeStyles({
  strip: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  list: {
    listStyleType: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexWrap: "wrap",
    gap: "6px",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "3px",
    paddingRight: "9px",
    paddingBottom: "3px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: "11px",
    maxWidth: "100%",
  },
  dot: { width: "6px", height: "6px", borderRadius: "9999px", flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
});

const TONE_DOT: Record<PulseEvent["tone"], string> = {
  brand: "#6366f1",
  warning: "#f59e0b",
  success: "#16a34a",
  neutral: "#9ca3af",
};

export function LiveOfficePulseStrip({
  events,
  onSelectEmployee,
  onOpenMission,
}: {
  events: PulseEvent[];
  onSelectEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
}) {
  const { t } = useI18n();
  const s = useStyles();

  return (
    <div className={s.strip} role="region" aria-label={t("office.floor.pulseTitle")}>
      {events.length === 0 ? (
        <Text size={100} className={s.muted}>
          {t("office.floor.pulseEmpty")}
        </Text>
      ) : (
        <ul className={s.list}>
          {events.map((ev) => (
            <li key={ev.id} className={s.chip}>
              <span className={s.dot} style={{ backgroundColor: TONE_DOT[ev.tone] }} aria-hidden />
              {ev.missionId ? (
                <Link as="button" style={{ fontSize: "11px" }} onClick={() => onOpenMission(ev.missionId!)}>
                  {ev.text}
                </Link>
              ) : ev.employeeId ? (
                <Link as="button" style={{ fontSize: "11px" }} onClick={() => onSelectEmployee(ev.employeeId!)}>
                  {ev.text}
                </Link>
              ) : (
                <span>{ev.text}</span>
              )}
              <Text size={100} className={s.muted}>
                {timeText(ev.at)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
