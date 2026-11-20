// What every page of the Governance console shares: a card, a page header, the badges that say a state in words, and
// the way a time, a digest or a principal is written.
import { Badge, Text, makeStyles, mergeClasses, shorthands, tokens, type FieldControlProps } from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";

export const useParts = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "18px",
    maxWidth: "1120px",
    width: "100%",
    marginTop: 0,
    marginRight: "auto",
    marginBottom: 0,
    marginLeft: "auto",
    boxSizing: "border-box",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "18px",
    paddingBottom: "18px",
    paddingLeft: "20px",
    paddingRight: "20px",
    "@media (max-width: 639px)": {
      paddingTop: "14px",
      paddingBottom: "14px",
      paddingLeft: "14px",
      paddingRight: "14px",
    },
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: "16px",
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  bento: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "16px",
    "@media (max-width: 899px)": { gridTemplateColumns: "1fr" },
  },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  between: { display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" },
  cardTitleWrap: { display: "inline-flex", alignItems: "center", gap: "10px", minWidth: 0, flexWrap: "wrap" },
  cardIcon: {
    width: "28px",
    height: "28px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardTitleStack: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    "@media (min-width: 640px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
    "@media (min-width: 1440px)": { gridTemplateColumns: "repeat(6, minmax(0, 1fr))" },
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", "transparent"),
    textAlign: "left",
    width: "100%",
    fontVariantNumeric: "tabular-nums",
    transitionProperty: "background-color, border-color, transform",
    transitionDuration: "140ms",
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
  },
  statButton: {
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1),
    },
    ":active": { transform: "scale(0.99)" },
  },
  statToneWarning: {
    backgroundColor: tokens.colorPaletteMarigoldBackground1,
    ...shorthands.borderColor(tokens.colorPaletteMarigoldBorder1),
  },
  statToneDanger: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    ...shorthands.borderColor(tokens.colorPaletteRedBorder1),
  },
  statHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    width: "100%",
    color: tokens.colorNeutralForeground3,
  },
  statValue: {
    fontSize: "24px",
    lineHeight: "1.15",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  inset: {
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: "12px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
  },
  pillBar: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  filterPill: { borderRadius: "9999px", minHeight: "32px", "@media (pointer: coarse)": { minHeight: "38px" } },
  empty: {
    paddingTop: "24px",
    paddingBottom: "24px",
    paddingLeft: "16px",
    paddingRight: "16px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all" },
  codeChip: {
    display: "inline-block",
    maxWidth: "100%",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    paddingTop: "2px",
    paddingRight: "6px",
    paddingBottom: "2px",
    paddingLeft: "6px",
    borderRadius: "6px",
    wordBreak: "normal",
    overflowWrap: "anywhere",
  },
  pre: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    paddingTop: "10px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    paddingRight: "12px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    maxHeight: "360px",
    overflowY: "auto",
  },
  list: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  scroll: { overflowX: "auto", minWidth: 0 },
  tableWrap: {
    width: "100%",
    overflowX: "auto",
    minWidth: 0,
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    "& table": {
      tableLayout: "auto",
      width: "100%",
    },
    "& thead th": {
      backgroundColor: tokens.colorNeutralBackground2,
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
      fontWeight: tokens.fontWeightSemibold,
    },
    "& tbody tr:hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  selectWrap: {
    position: "relative",
    display: "inline-flex",
    minWidth: "140px",
    maxWidth: "100%",
    boxSizing: "border-box",
    minHeight: "36px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
    borderRadius: "10px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    transitionProperty: "border-color, background-color",
    transitionDuration: "140ms",
    ":hover": { ...shorthands.borderColor(tokens.colorNeutralStroke1Hover) },
    ":focus-within": { ...shorthands.borderColor(tokens.colorCompoundBrandStroke), outlineWidth: "1px", outlineStyle: "solid", outlineColor: tokens.colorCompoundBrandStroke },
  },
  selectFace: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    width: "100%",
    minHeight: "inherit",
    paddingTop: "5px",
    paddingRight: "10px",
    paddingBottom: "5px",
    paddingLeft: "12px",
    pointerEvents: "none",
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
  },
  selectValue: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  selectCaret: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  selectOverlay: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    opacity: 0,
    cursor: "pointer",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    ...shorthands.border("0"),
    zIndex: 1,
  },
});

export function Card({
  title,
  icon,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const s = useParts();
  return (
    <section className={mergeClasses(s.card, className)}>
      {(title !== undefined || actions !== undefined || description !== undefined) && (
        <div className={s.between}>
          <div className={s.cardTitleWrap}>
            {icon !== undefined && (
              <span className={s.cardIcon} aria-hidden>
                {icon}
              </span>
            )}
            <div className={s.cardTitleStack}>
              {title !== undefined && (
                <Text weight="semibold" size={400}>
                  {title}
                </Text>
              )}
              {description !== undefined && (
                <Text size={200} className={s.muted}>
                  {description}
                </Text>
              )}
            </div>
          </div>
          {actions !== undefined && <div className={s.row}>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  onClick,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  onClick?: () => void;
  tone?: "neutral" | "warning" | "danger";
}) {
  const s = useParts();
  const toneClass = tone === "warning" ? s.statToneWarning : tone === "danger" ? s.statToneDanger : undefined;
  const content = (
    <>
      <span className={s.statHead}>
        <Text size={200}>{label}</Text>
        {onClick && <ChevronRight16Regular aria-hidden />}
      </span>
      <Text className={s.statValue}>{value}</Text>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={mergeClasses(s.stat, s.statButton, toneClass)} onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className={mergeClasses(s.stat, toneClass)}>{content}</div>;
}

export interface SelectOption {
  value: string;
  label: string;
}

export function CleanSelect({
  value,
  options,
  onChange,
  fieldProps,
  ariaLabel,
  disabled,
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  fieldProps?: FieldControlProps;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const s = useParts();
  const display = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className={mergeClasses(s.selectWrap, className)}>
      <div className={s.selectFace} aria-hidden>
        <span className={s.selectValue}>{display}</span>
        <ChevronDown16Regular className={s.selectCaret} />
      </div>
      <select
        {...fieldProps}
        aria-label={ariaLabel}
        className={s.selectOverlay}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
    <Badge appearance="tint" color={TONES[value] ?? "informative"} style={{ borderRadius: "9999px", flexShrink: 0, whiteSpace: "nowrap" }}>
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
