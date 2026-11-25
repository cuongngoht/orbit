// An IANA time zone, chosen from the ones this browser knows (the API checks the name again). The browser's own zone is
// what a new account starts from.
import { Select, type SelectProps } from "@fluentui/react-components";
import { memo, useMemo } from "react";

export const browserTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

// The current IANA names of zones the browser's own list (CLDR's) still spells the old way (Asia/Saigon, Asia/Calcutta):
// a person looks for the name they know, and the API accepts both.
const CURRENT_NAMES = ["Asia/Ho_Chi_Minh", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Yangon", "Europe/Kyiv", "America/Nuuk", "Atlantic/Faroe", "Pacific/Chuuk", "Pacific/Pohnpei", "America/Argentina/Buenos_Aires"];

const accepted = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

function zones(including: string): string[] {
  const known = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const all = new Set([...known, ...CURRENT_NAMES.filter(accepted), "UTC", including]);
  return [...all].filter((z) => z.length > 0).sort((a, b) => a.localeCompare(b));
}

const ZONE_LABELS = new Map<string, string>();

const zoneLabel = (zone: string): string => {
  const cached = ZONE_LABELS.get(zone);
  if (cached !== undefined) return cached;
  let label = zone;
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    if (part) label = `${zone} (${part})`;
  } catch {
    // Keep raw zone identifier when Intl lacks shortOffset support.
  }
  ZONE_LABELS.set(zone, label);
  return label;
};

export const TimeZoneSelect = memo(function TimeZoneSelect({ value, onChange, ...rest }: { value: string; onChange: (zone: string) => void } & Omit<SelectProps, "value" | "onChange">) {
  const options = useMemo(
    () =>
      zones(value).map((z) => (
        <option key={z} value={z}>
          {zoneLabel(z)}
        </option>
      )),
    [value],
  );
  return (
    <Select {...rest} value={value} onChange={(_, d) => onChange(d.value)}>
      {options}
    </Select>
  );
});
