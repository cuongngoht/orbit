// VIRTUAL WORKPLACE PREFERENCES, ACCENTS, AVATAR PALETTES, ELAPSED HELPERS & OPTIONAL CHIME:
// Keeps user-chosen studio settings (density, sound opt-in, collapsed rooms, custom room colors, avatar outfit/hair/accessory)
// safely in localStorage with live cross-component sync, plus pure helpers shared across Floor, List, Spotlight, and Employee pages.
import type { EmployeeCard } from "@orbit-web/contracts";
import { useCallback, useEffect, useState } from "react";

export type FloorDensity = "cozy" | "compact";

export type AvatarHairStyle = 0 | 1 | 2 | 3 | 4 | 5;
export type AvatarAccessory = 0 | 1 | 2 | 3 | 4;

export interface AvatarCustomization {
  shirt?: number;
  hair?: number;
  hairStyle?: AvatarHairStyle;
  accessory?: AvatarAccessory;
}

export interface FloorPrefs {
  density: FloorDensity;
  soundEnabled: boolean;
  pulseOpen: boolean;
  collapsedRooms: Record<string, boolean>;
  deptAccents: Record<string, number>;
  avatarStyles: Record<string, AvatarCustomization>;
}

export const ROOM_ACCENTS = [
  { name: "Indigo", dot: "#5b58d4", tint: "rgba(91, 88, 212, 0.045)", border: "rgba(91, 88, 212, 0.16)" },
  { name: "Teal", dot: "#0d9488", tint: "rgba(13, 148, 136, 0.045)", border: "rgba(13, 148, 136, 0.16)" },
  { name: "Amber", dot: "#d97706", tint: "rgba(217, 119, 6, 0.045)", border: "rgba(217, 119, 6, 0.16)" },
  { name: "Violet", dot: "#9333ea", tint: "rgba(147, 51, 234, 0.045)", border: "rgba(147, 51, 234, 0.16)" },
  { name: "Cobalt", dot: "#2563eb", tint: "rgba(37, 99, 235, 0.045)", border: "rgba(37, 99, 235, 0.16)" },
  { name: "Rose", dot: "#e11d48", tint: "rgba(225, 29, 72, 0.045)", border: "rgba(225, 29, 72, 0.16)" },
] as const;

export const AVATAR_SHIRTS = [
  { shirt: "#5b58d4", shirtShade: "#3f3ca8", shirtTrim: "#c7d2fe", mug: "#fb7185", bg: "#eef0ff" },
  { shirt: "#0f9488", shirtShade: "#0b6b63", shirtTrim: "#99f6e4", mug: "#f59e0b", bg: "#e6f7f5" },
  { shirt: "#9333ea", shirtShade: "#6b21a8", shirtTrim: "#e9d5ff", mug: "#14b8a6", bg: "#f5edff" },
  { shirt: "#ea580c", shirtShade: "#b43f09", shirtTrim: "#fed7aa", mug: "#5b58d4", bg: "#fff1e6" },
  { shirt: "#2563eb", shirtShade: "#1d4ed8", shirtTrim: "#bfdbfe", mug: "#f43f5e", bg: "#eaf2ff" },
  { shirt: "#16a34a", shirtShade: "#15803d", shirtTrim: "#bbf7d0", mug: "#f59e0b", bg: "#e9f9ef" },
  { shirt: "#db2777", shirtShade: "#9d174d", shirtTrim: "#fbcfe8", mug: "#0ea5e9", bg: "#fdecf4" },
  { shirt: "#ca8a04", shirtShade: "#92400e", shirtTrim: "#fef08a", mug: "#6366f1", bg: "#fef8e4" },
] as const;

export const AVATAR_SHIRT_SWATCHES = AVATAR_SHIRTS.map((s) => s.shirt);

export const AVATAR_HAIRS = [
  { main: "#231f20", shade: "#110f10" }, // Espresso Black
  { main: "#784421", shade: "#4d2a13" }, // Warm Chestnut
  { main: "#c45b28", shade: "#8c3c16" }, // Auburn Copper
  { main: "#d9a73b", shade: "#a6781c" }, // Golden Blonde
  { main: "#25395c", shade: "#16243d" }, // Midnight Navy
  { main: "#7d889c", shade: "#525b6e" }, // Silver Slate
  { main: "#773f8c", shade: "#4f265e" }, // Deep Plum
  { main: "#1f9d87", shade: "#146e5e" }, // Teal Mint
  { main: "#b84569", shade: "#852c48" }, // Rose Berry
  { main: "#5e4c41", shade: "#3d3028" }, // Ash Brunette
] as const;

export const DEFAULT_FLOOR_PREFS: FloorPrefs = {
  density: "cozy",
  soundEnabled: false,
  pulseOpen: false,
  collapsedRooms: {},
  deptAccents: {},
  avatarStyles: {},
};

const STORAGE_KEY = "orbit.office.floorPrefs.v1";
const PREFS_EVENT = "orbit:floorPrefs";

export function roomAccentFor(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return ROOM_ACCENTS[h % ROOM_ACCENTS.length]!;
}

export function accentForDepartment(deptId: string | null, label: string, prefs?: Pick<FloorPrefs, "deptAccents">) {
  const custom = deptId !== null ? prefs?.deptAccents[deptId] : undefined;
  if (typeof custom === "number" && Number.isInteger(custom) && custom >= 0 && custom < ROOM_ACCENTS.length) {
    return ROOM_ACCENTS[custom]!;
  }
  return roomAccentFor(label);
}

export function readFloorPrefs(): FloorPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FLOOR_PREFS;
    const parsed = JSON.parse(raw) as Partial<FloorPrefs>;
    return {
      density: parsed.density === "compact" ? "compact" : "cozy",
      soundEnabled: parsed.soundEnabled === true,
      pulseOpen: parsed.pulseOpen === true,
      collapsedRooms: parsed.collapsedRooms && typeof parsed.collapsedRooms === "object" ? parsed.collapsedRooms : {},
      deptAccents: parsed.deptAccents && typeof parsed.deptAccents === "object" ? parsed.deptAccents : {},
      avatarStyles: parsed.avatarStyles && typeof parsed.avatarStyles === "object" ? parsed.avatarStyles : {},
    };
  } catch {
    return DEFAULT_FLOOR_PREFS;
  }
}

function writeFloorPrefs(next: FloorPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT));
  } catch {
    // Storage quota or privacy mode: keep working in-memory without disturbing the user.
  }
}

export function useFloorPrefs() {
  const [prefs, setPrefs] = useState<FloorPrefs>(() => readFloorPrefs());

  useEffect(() => {
    const sync = () => setPrefs(readFloorPrefs());
    window.addEventListener(PREFS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PREFS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = useCallback((updater: (prev: FloorPrefs) => FloorPrefs) => {
    setPrefs((prev) => {
      const next = updater(prev);
      writeFloorPrefs(next);
      return next;
    });
  }, []);

  const toggleDensity = useCallback(
    () => update((p) => ({ ...p, density: p.density === "cozy" ? "compact" : "cozy" })),
    [update],
  );
  const toggleSound = useCallback(() => update((p) => ({ ...p, soundEnabled: !p.soundEnabled })), [update]);
  const togglePulse = useCallback(() => update((p) => ({ ...p, pulseOpen: !p.pulseOpen })), [update]);
  const toggleRoomCollapsed = useCallback(
    (deptKey: string) =>
      update((p) => ({ ...p, collapsedRooms: { ...p.collapsedRooms, [deptKey]: !p.collapsedRooms[deptKey] } })),
    [update],
  );
  const cycleDeptAccent = useCallback(
    (deptId: string, label: string) =>
      update((p) => {
        const cur = accentForDepartment(deptId, label, p);
        const curIdx = ROOM_ACCENTS.indexOf(cur);
        const nextIdx = (curIdx + 1) % ROOM_ACCENTS.length;
        return { ...p, deptAccents: { ...p.deptAccents, [deptId]: nextIdx } };
      }),
    [update],
  );
  const setAvatarStyle = useCallback(
    (employeeId: string, style: AvatarCustomization | null) =>
      update((p) => {
        const nextStyles = { ...p.avatarStyles };
        if (style === null) delete nextStyles[employeeId];
        else nextStyles[employeeId] = style;
        return { ...p, avatarStyles: nextStyles };
      }),
    [update],
  );

  return { prefs, toggleDensity, toggleSound, togglePulse, toggleRoomCollapsed, cycleDeptAccent, setAvatarStyle };
}

export function needsAttention(e: EmployeeCard): boolean {
  return (
    e.workLabel === "waiting_review" ||
    e.workLabel === "waiting_info" ||
    e.workLabel === "waiting_resources" ||
    e.workLabel === "not_ready" ||
    e.connectionWarning !== null
  );
}

export function formatElapsed(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const started = Date.parse(iso);
  if (!Number.isFinite(started)) return null;
  const diffSec = Math.max(0, Math.floor((nowMs - started) / 1000));
  if (diffSec < 60) return "<1m";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

export function playNotificationChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [659.25, 987.77]; // gentle E5 -> B5 bell
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.055, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.36);
    });
    window.setTimeout(() => void ctx.close(), 700);
  } catch {
    // Ignore autoplay restrictions or missing Web Audio API in headless/test environments.
  }
}
