// Numbers and times the way a person reads them. One place, so every page
// says "12.4 KB" and "3 min ago" the same way.

const LOCALE = undefined;

export const formatCount = (n: number) => new Intl.NumberFormat(LOCALE).format(n);

// 7,791 → "7.8K": for a stat tile, where the exact number lives in a caption.
export const formatCompact = (n: number) => new Intl.NumberFormat(LOCALE, { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? ["second", 1];
  if (unit === "second") return "just now";
  return new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto", style: "short" }).format(Math.round(seconds / size), unit);
}

export const formatDateTime = (iso: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

// To the second: a trail's steps land moments apart, and must not all read alike.
export const formatInstant = (iso: string) => new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));

// An age in milliseconds, to the second where seconds matter: a connectivity answer from ten seconds
// ago and one from fifty are different news, and "just now" would hide it. `null` is never.
export function formatAge(ms: number | null): string {
  if (ms === null) return "never";
  if (ms < 5000) return "just now";
  if (ms < 60_000) return `${Math.round(ms / 1000)} s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min ago`;
  return ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h ago` : `${Math.round(ms / 86_400_000)} d ago`;
}

// How long something has been going, or took: "5.2s" under a minute, "00:08:21" after. A duration is
// what the journal's times say, never an estimate of what is left.
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0.0s";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, "0")).join(":");
}

/** HH:mm:ss, the time of day a line was written: a live feed's lines land seconds apart. */
export const formatClock = (iso: string) => new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(iso));
