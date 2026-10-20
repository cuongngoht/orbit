import type { ConnectivityBlock, Provider, ReachTargetSetting, RetryPolicy } from "./runtime.types";
import { PROVIDERS } from "./runtimeWords";

// The connectivity settings as the form holds them, and back. Pure, so what a save sends is a
// function of what was read and what was typed, and nothing else: a target nobody touched goes back
// as it came -- its note and its own retry policy with it -- and the numbers a person typed are sent
// as typed, to be judged by the ENGINE's rules (src/runtime/settings.mjs). The page repeats none of
// them, so a refusal reads in the engine's words.

/** Every number a string, and an empty one is "not set": the machine's policy for a target, the engine's default for the machine. */
export interface RetryDraft {
  attempts: string;
  intervalMs: string;
  timeoutMs: string;
}

export interface TargetDraft {
  /** Stable while the id is typed, so React keeps the row. */
  row: number;
  id: string;
  label: string;
  host: string;
  port: string;
  requiredBy: string[];
  checkFrom: Provider[];
  beforeStart: boolean;
  retry: RetryDraft;
  note: string;
  /** Not this form's to edit: sent back as it was read. */
  classification?: ReachTargetSetting["classification"];
  /** Saved before: what it observed is kept under its id, so the id is not retyped. */
  saved: boolean;
}

export interface ConnectivityDraft {
  retry: RetryDraft;
  targets: TargetDraft[];
}

const RETRY_KEYS = ["attempts", "intervalMs", "timeoutMs"] as const;

const textOf = (n: number | undefined) => (n === undefined ? "" : String(n));

export const retryDraftOf = (r: Partial<RetryPolicy> | undefined): RetryDraft => ({ attempts: textOf(r?.attempts), intervalMs: textOf(r?.intervalMs), timeoutMs: textOf(r?.timeoutMs) });

const targetDraftOf = (id: string, t: ReachTargetSetting, row: number): TargetDraft => ({ row, id, label: t.label, host: t.host, port: String(t.port), requiredBy: [...t.requiredBy], checkFrom: [...t.checkFrom], beforeStart: t.beforeStart, retry: retryDraftOf(t.retry), note: t.note ?? "", saved: true, ...(t.classification ? { classification: t.classification } : {}) });

// In the order the Connectivity card shows them: by id.
export const connectivityDraftOf = (c: ConnectivityBlock): ConnectivityDraft => ({ retry: retryDraftOf(c.retry), targets: Object.entries(c.targets).sort(([a], [b]) => a.localeCompare(b)).map(([id, t], row) => targetDraftOf(id, t, row)) });

// A new target is checked from everywhere it can be until a person says otherwise: the host and the
// container are two networks, and the point is to see both.
export const newTarget = (targets: TargetDraft[]): TargetDraft => ({ row: Math.max(-1, ...targets.map((t) => t.row)) + 1, id: "", label: "", host: "", port: "", requiredBy: [], checkFrom: [...PROVIDERS], beforeStart: false, retry: retryDraftOf(undefined), note: "", saved: false });

/** Only the numbers a person typed: an empty field is left to the policy under it. */
export const retryOf = (d: RetryDraft): Partial<RetryPolicy> => Object.fromEntries(RETRY_KEYS.filter((k) => d[k].trim() !== "").map((k) => [k, Number(d[k])]));

function settingOf(d: TargetDraft): ReachTargetSetting {
  const retry = retryOf(d.retry);
  const note = d.note.trim();
  return { label: d.label.trim() || d.id.trim(), host: d.host.trim(), port: Number(d.port), protocol: "tcp", requiredBy: d.requiredBy, checkFrom: d.checkFrom, beforeStart: d.beforeStart, ...(Object.keys(retry).length ? { retry } : {}), ...(note ? { note } : {}), ...(d.classification ? { classification: d.classification } : {}) };
}

export const connectivityOf = (d: ConnectivityDraft): ConnectivityBlock => ({ retry: retryOf(d.retry), targets: Object.fromEntries(d.targets.map((t) => [t.id.trim(), settingOf(t)])) });

// Two targets under one id would be one target once saved, and the other would be lost without a
// word: the one thing about these settings the engine cannot see, because it only ever gets one.
export function duplicateIds(d: ConnectivityDraft): string[] {
  const ids = d.targets.map((t) => t.id.trim()).filter(Boolean);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

/** What a list of checkboxes holds after one changes -- in the order the boxes are SHOWN, so a save does not depend on the order they were clicked. */
export const toggled = <T>(shown: readonly T[], list: readonly T[], value: T, on: boolean): T[] => shown.filter((v) => (v === value ? on : list.includes(v)));
