// What every page of the Governance console shares: a card, a page header, the badges that say a state in words, and
// the way a time, a digest or a principal is written.
import { Badge, MessageBar, MessageBarBody, Text, makeStyles, mergeClasses, shorthands, tokens, type FieldControlProps } from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { IconBadge, type IconTone } from "../../components/SectionIcons";

export const useParts = makeStyles({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
    maxWidth: "1160px",
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
    "@media (max-width: 767px)": { gridTemplateColumns: "1fr" },
  },
  row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", minWidth: 0 },
  between: { display: "flex", gap: "10px", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", minWidth: 0 },
  cardTitleWrap: { display: "inline-flex", alignItems: "flex-start", gap: "10px", minWidth: 0, flexWrap: "nowrap", flexGrow: 1, flexShrink: 1, flexBasis: "240px" },
  cardTitleStack: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1 },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    "@media (min-width: 640px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
    "@media (min-width: 1100px)": { gridTemplateColumns: "repeat(6, minmax(0, 1fr))" },
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
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    textAlign: "left",
    width: "100%",
    fontVariantNumeric: "tabular-nums",
    transitionProperty: "background-color, border-color, box-shadow, transform",
    transitionDuration: "140ms",
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
  },
  statButton: {
    cursor: "pointer",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      boxShadow: tokens.shadow4,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
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
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
  },
  toolbarBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "10px",
    paddingRight: "14px",
    paddingBottom: "10px",
    paddingLeft: "14px",
    borderRadius: "14px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  pillBar: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    flexWrap: "wrap",
    paddingTop: "3px",
    paddingRight: "3px",
    paddingBottom: "3px",
    paddingLeft: "3px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  filterPill: {
    borderRadius: "9999px",
    minHeight: "30px",
    "&[data-fui-focus-visible]::after": { borderRadius: "9999px" },
    "@media (pointer: coarse)": { minHeight: "38px" },
  },
  divider: { height: "1px", width: "100%", backgroundColor: tokens.colorNeutralStroke2, flexShrink: 0 },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    paddingTop: "32px",
    paddingBottom: "32px",
    paddingLeft: "20px",
    paddingRight: "20px",
    borderRadius: "14px",
    ...shorthands.border("1px", "dashed", tokens.colorNeutralStroke1),
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
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
  badgeInner: { display: "inline-flex", alignItems: "center", gap: "5px" },
  badgeDot: { width: "6px", height: "6px", borderRadius: "9999px", backgroundColor: "currentColor", flexShrink: 0 },
});

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function Card({
  title,
  icon,
  tone = "brand",
  description,
  actions,
  children,
  className,
  label,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  tone?: IconTone;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  // The card's accessible name, when it should be a landmark a person can jump to.
  label?: string;
}) {
  const s = useParts();
  return (
    <section className={mergeClasses(s.card, className)} aria-label={label}>
      {(title !== undefined || actions !== undefined || description !== undefined) && (
        <div className={s.between}>
          <div className={s.cardTitleWrap}>
            {icon !== undefined && <IconBadge icon={icon} tone={tone} size="md" />}
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

export function EmptyState({ icon, tone = "brand", title, body, action }: { icon?: ReactNode; tone?: IconTone; title: string; body?: string; action?: ReactNode }) {
  const s = useParts();
  return (
    <div className={s.empty}>
      {icon && <IconBadge icon={icon} tone={tone} size="lg" />}
      <Text weight="semibold" size={300} style={{ color: tokens.colorNeutralForeground1, textAlign: "center" }}>
        {title}
      </Text>
      {body && (
        <Text size={200} className={s.muted} style={{ maxWidth: "440px", textAlign: "center" }}>
          {body}
        </Text>
      )}
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  icon,
  iconTone = "neutral",
  onClick,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  iconTone?: IconTone;
  onClick?: () => void;
  tone?: "neutral" | "warning" | "danger";
}) {
  const s = useParts();
  const toneClass = tone === "warning" ? s.statToneWarning : tone === "danger" ? s.statToneDanger : undefined;
  const content = (
    <>
      <span className={s.statHead}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "7px", minWidth: 0 }}>
          {icon && <IconBadge icon={icon} tone={iconTone} size="sm" />}
          <Text size={200} style={{ minWidth: 0 }}>
            {label}
          </Text>
        </span>
        {onClick && <ChevronRight16Regular aria-hidden style={{ flexShrink: 0 }} />}
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
  PUBLISHED: "success",
  SUPERSEDED: "subtle",
  DISCARDED: "subtle",
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
  boundary: "success",
  control: "brand",
  runtime: "warning",
  none: "subtle",
  overridden: "brand",
  deleted: "subtle",
};

const LABELS: Record<string, string> = {
  require_approval: "requires approval",
  not_proven: "not proven",
};

// A word of governance, said as a badge whose colour says how much it allows or how bad it is.
export function Word({ value, label }: { value: string; label?: string }) {
  const s = useParts();
  return (
    <Badge appearance="tint" color={TONES[value] ?? "informative"} style={{ borderRadius: "9999px", flexShrink: 0, whiteSpace: "nowrap" }}>
      <span className={s.badgeInner}>
        <span className={s.badgeDot} aria-hidden />
        <span>{label ?? LABELS[value] ?? value.replace(/_/g, " ").toLowerCase()}</span>
      </span>
    </Badge>
  );
}

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "—");

export const short = (hex: string | null | undefined, n = 12): string => (hex ? hex.slice(0, n) : "—");

// How a record names who did something (`owner:<account>`, `agent:<id>`, `system:<what>`), said for the account's owner
// reading it: the owner is "you", Orbit Web's own work is Orbit Web's, an agent is named by its id.
export function byWhom(label: string | null | undefined): string {
  if (!label) return "—";
  if (label.startsWith("owner:")) return "you";
  if (label.startsWith("system:")) return "Orbit Web";
  if (label.startsWith("agent:")) return `an agent (${short(label.slice("agent:".length), 16)})`;
  if (label === "anonymous" || label === "agent-network") return "nobody verified";
  return label;
}

// Who a record or a decision says acted, by its principal type: the owner (a person), one of the account's agents,
// Orbit Web itself, or somebody nobody verified.
export function principalOf(type: string, id: string, agentId: string | null): string {
  if (type === "human") return "you";
  if (type === "agent") return `agent ${short(agentId ?? id, 16)}`;
  if (type === "system" || type === "service") return `Orbit Web (${id})`;
  return "nobody verified";
}

export function ErrorBar({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <MessageBar intent="error">
      <MessageBarBody>{text}</MessageBarBody>
    </MessageBar>
  );
}
