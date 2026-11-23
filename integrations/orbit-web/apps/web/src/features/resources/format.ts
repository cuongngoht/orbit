// How resources are said: CPU in vCPU (the API counts millicores), memory and storage in GiB or MiB (the API counts
// MiB), and an enforcement level as what it means -- a limit the kernel holds, a measurement, or nothing.
import type { EnforcementLevel, StorageArea, StorageCategory } from "@orbit-web/contracts";
import { t as tr, type MessageKey } from "../../i18n";

const n = (v: number, digits = 2): string => v.toLocaleString("en-US", { maximumFractionDigits: digits });

export const cpuText = (millis: number | null | undefined): string => (millis === null || millis === undefined ? tr("settings.resources.unknown") : tr("settings.resources.vcpu", { value: n(millis / 1000) }));

export const sizeText = (mib: number | null | undefined): string => {
  if (mib === null || mib === undefined) return tr("settings.resources.unknown");
  if (Math.abs(mib) >= 1024) return tr("settings.resources.gib", { value: n(mib / 1024, 1) });
  return tr("settings.resources.mib", { value: n(mib, 0) });
};

// A file's size, from its bytes: small files in bytes or KiB, larger ones as sizeText says them.
export const bytesText = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined) return tr("settings.resources.unknown");
  if (bytes < 1024) return bytes === 1 ? tr("settings.resources.byteOne", { value: n(bytes, 0) }) : tr("settings.resources.byteMany", { value: n(bytes, 0) });
  if (bytes < 1024 * 1024) return tr("settings.resources.kib", { value: n(bytes / 1024, 1) });
  return sizeText(bytes / (1024 * 1024));
};

export const LEVEL_KEYS: Record<EnforcementLevel, MessageKey> = {
  HARD_ENFORCED: "settings.resources.level.hard",
  SOFT_MONITORED: "settings.resources.level.soft",
  UNSUPPORTED: "settings.resources.level.unsupported",
};

export const LEVEL_TEXT: Record<EnforcementLevel, string> = {
  HARD_ENFORCED: tr(LEVEL_KEYS.HARD_ENFORCED),
  SOFT_MONITORED: tr(LEVEL_KEYS.SOFT_MONITORED),
  UNSUPPORTED: tr(LEVEL_KEYS.UNSUPPORTED),
};

export const LEVEL_TONE: Record<EnforcementLevel, "success" | "warning" | "danger"> = { HARD_ENFORCED: "success", SOFT_MONITORED: "warning", UNSUPPORTED: "danger" };

export const AREA_TEXT: Record<StorageArea, string> = {
  desk: tr("settings.resources.area.desk"),
  cache: tr("settings.resources.area.cache"),
  scratch: tr("settings.resources.area.scratch"),
  team: tr("settings.resources.area.team"),
  tmp: tr("settings.resources.area.tmp"),
};

export const CATEGORY_KEYS: Record<StorageCategory, MessageKey> = {
  desk: "settings.resources.category.desk",
  cache: "settings.resources.category.cache",
  team: "settings.resources.category.team",
  scratch: "settings.resources.category.scratch",
  artifacts: "settings.resources.category.artifacts",
  research: "settings.resources.category.research",
  logs: "settings.resources.category.logs",
};

export const CATEGORY_TEXT: Record<StorageCategory, string> = {
  desk: tr(CATEGORY_KEYS.desk),
  cache: tr(CATEGORY_KEYS.cache),
  team: tr(CATEGORY_KEYS.team),
  scratch: tr(CATEGORY_KEYS.scratch),
  artifacts: tr(CATEGORY_KEYS.artifacts),
  research: tr(CATEGORY_KEYS.research),
  logs: tr(CATEGORY_KEYS.logs),
};

export const CAPACITY_SOURCE_KEYS: Record<"detected" | "configured" | "unknown", MessageKey> = {
  detected: "settings.resources.capacitySource.detected",
  configured: "settings.resources.capacitySource.configured",
  unknown: "settings.resources.capacitySource.unknown",
};

export const CAPACITY_SOURCE_TEXT: Record<"detected" | "configured" | "unknown", string> = {
  detected: tr(CAPACITY_SOURCE_KEYS.detected),
  configured: tr(CAPACITY_SOURCE_KEYS.configured),
  unknown: tr(CAPACITY_SOURCE_KEYS.unknown),
};

// vCPU and GiB as a person types them, and back.
export const toVcpu = (millis: number): number => millis / 1000;
export const fromVcpu = (vcpu: number): number => Math.round(vcpu * 1000);
export const toGiB = (mib: number): number => Math.round((mib / 1024) * 100) / 100;
export const fromGiB = (gib: number): number => Math.round(gib * 1024);
