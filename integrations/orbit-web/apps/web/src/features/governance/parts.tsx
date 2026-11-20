// What every page of the Governance console shares: a card, a page header, the badges that say a state in words, and
// the way a time, a digest or a principal is written.
import { Badge, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";

export const useParts = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "1080px", width: "100%", boxSizing: "border-box" },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "16px",
    paddingBottom: "16px",
    paddingLeft: "18px",
    paddingRight: "18px",
    borderTopWidth: "1px",
    borderRightWidth: "1px",
    borderBottomWidth: "1px",
    borderLeftWidth: "1px",
    borderTopStyle: "solid",
    borderRightStyle: "solid",
    borderBottomStyle: "solid",
    borderLeftStyle: "solid",
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorNeutralStroke2,
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  between: { display: "flex", gap: "8px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    fontVariantNumeric: "tabular-nums",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all" },
  pre: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    margin: 0,
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingLeft: "10px",
    paddingRight: "10px",
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    maxHeight: "360px",
    overflowY: "auto",
  },
  list: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  scroll: { overflowX: "auto", minWidth: 0 },
});

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  const s = useParts();
  return (
    <section className={mergeClasses(s.card, className)}>
      {(title !== undefined || actions !== undefined) && (
        <div className={s.between}>
          {title !== undefined && (
            <Text weight="semibold" size={400}>
              {title}
            </Text>
          )}
          {actions !== undefined && <div className={s.row}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  const s = useParts();
  return (
    <div className={s.stat}>
      <Text size={200} className={s.muted}>
        {label}
      </Text>
      <Text size={500} weight="semibold">
        {value}
      </Text>
    </div>
  );
}

type Tone = "brand" | "danger" | "important" | "informative" | "severe" | "subtle" | "success" | "warning";

const TONES: Record<string, Tone> = {
  allow: "success",
  require_approval: "warning",
  deny: "danger",
  DRAFT: "subtle",
  VALIDATED: "informative",
  PENDING_APPROVAL: "warning",
  APPROVED: "brand",
  PUBLISHED: "success",
  SUPERSEDED: "subtle",
  REJECTED: "danger",
  pending: "warning",
  granted: "brand",
  rejected: "danger",
  expired: "subtle",
  consumed: "success",
  low: "success",
  elevated: "warning",
  high: "danger",
  critical: "severe",
  medium: "warning",
  CONFIRMED: "danger",
  SUSPECTED: "warning",
  INCONCLUSIVE: "subtle",
  open: "warning",
  resolved: "success",
  accepted: "subtle",
  active: "success",
  suspended: "danger",
  attested: "success",
  not_proven: "warning",
  failed: "danger",
  GOVERNED_WORKSPACE: "brand",
  LEGACY_ORBIT: "subtle",
  boundary: "success",
  control: "brand",
  runtime: "warning",
  none: "subtle",
};

const LABELS: Record<string, string> = {
  require_approval: "requires approval",
  PENDING_APPROVAL: "pending approval",
  not_proven: "not proven",
  GOVERNED_WORKSPACE: "governed",
  LEGACY_ORBIT: "legacy",
};

// A word of governance, said as a badge whose colour says how much it allows or how bad it is.
export function Word({ value, label }: { value: string; label?: string }) {
  return (
    <Badge appearance="tint" color={TONES[value] ?? "informative"} style={{ borderRadius: "9999px" }}>
      {label ?? LABELS[value] ?? value.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "—");

export const short = (hex: string | null | undefined, n = 12): string => (hex ? hex.slice(0, n) : "—");

// How a record names who did something: an operator's id is shown as their username when it is known.
export function who(id: string | null | undefined, names: ReadonlyMap<string, string>): string {
  if (!id) return "—";
  return names.get(id) ?? id;
}
