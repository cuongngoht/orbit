// What every page of the Governance console shares: a card, a page header, the badges that say a state in words, and
// the way a time, a digest or a principal is written.
import { Badge, MessageBar, MessageBarBody, Text, makeStyles, mergeClasses, shorthands, tokens, type FieldControlProps } from "@fluentui/react-components";
import { ChevronDown16Regular, ChevronRight16Regular } from "@fluentui/react-icons";
import type { EmployeeDeskList, Roster } from "@orbit-web/contracts";
import { useMemo, type ReactNode } from "react";
import { IconBadge, type IconTone } from "../../components/SectionIcons";
import { useResource } from "../../hooks/useResource";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { get } from "../../services/api";

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
  cardTitleWrap: { display: "inline-flex", alignItems: "flex-start", gap: "10px", minWidth: 0, flexWrap: "nowrap", flexGrow: 1, flexShrink: 1, flexBasis: "160px" },
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
    "@media (max-width: 639px)": { borderRadius: "14px", width: "100%" },
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

// `o` with `key` said as `v` -- or not said at all when `v` is undefined: how a page writes one part of a policy document
// back, leaving every other part as it was.
export function put<T extends object, K extends keyof T>(o: T, key: K, v: T[K] | undefined): T {
  const { [key]: _was, ...rest } = o;
  return (v === undefined ? rest : { ...rest, [key]: v }) as T;
}

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
  // A company rule binds every department (mandatory), or is its default for an action it delegated.
  mandatory: "brand",
  default: "subtle",
  // Employee network access: every public website, or only the hosts listed.
  AUTONOMOUS: "warning",
  RESTRICTED: "success",
};

const LABEL_KEYS: Record<string, MessageKey> = {
  require_approval: "governance.parts.word.require_approval",
  not_proven: "governance.parts.word.not_proven",
};

// A word of governance, said as a badge whose colour says how much it allows or how bad it is.
export function Word({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const s = useParts();
  return (
    <Badge appearance="tint" color={TONES[value] ?? "informative"} style={{ borderRadius: "9999px", flexShrink: 0, whiteSpace: "nowrap" }}>
      <span className={s.badgeInner}>
        <span className={s.badgeDot} aria-hidden />
        <span>{label ?? (LABEL_KEYS[value] ? t(LABEL_KEYS[value]) : value.replace(/_/g, " ").toLowerCase())}</span>
      </span>
    </Badge>
  );
}

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "—");

export const short = (hex: string | null | undefined, n = 12): string => (hex ? hex.slice(0, n) : "—");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hasEmployeeRef(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith("employee:") || value.startsWith("agent:employee:") || UUID_RE.test(value);
}

// How a record names who did something (`owner:<account>`, `agent:<id>`, `system:<what>`), said for the account's owner
// reading it: the owner is "you", Orbit Web's own work is Orbit Web's, an agent is named by its id or employee name.
export function byWhom(label: string | null | undefined, employeeNames?: ReadonlyMap<string, string>): string {
  if (!label) return "—";
  if (label.startsWith("owner:")) return tr("governance.parts.byWhom.you");
  if (label.startsWith("system:")) return tr("governance.parts.byWhom.orbitWeb");
  if (label.startsWith("agent:employee:") || label.startsWith("employee:")) {
    const empId = label.startsWith("agent:employee:") ? label.slice("agent:employee:".length) : label.slice("employee:".length);
    const name = employeeNames?.get(empId);
    if (name) return `${name} (agent)`;
    return tr("governance.parts.byWhom.agent", { id: short(label.replace(/^agent:/, ""), 16) });
  }
  if (label.startsWith("agent:")) return tr("governance.parts.byWhom.agent", { id: short(label.slice("agent:".length), 16) });
  if (label === "anonymous" || label === "agent-network") return tr("governance.parts.byWhom.unverified");
  return label;
}

// Map employee and department ids to their readable names when governance pages display employee actors or resources.
export function useGovernanceNames(needed: boolean): {
  employeeNames: ReadonlyMap<string, string>;
  departmentNames: ReadonlyMap<string, string>;
  settled: boolean;
} {
  const desks = useResource<EmployeeDeskList>(needed ? () => get("/api/office/desks") : null, [needed]);
  const roster = useResource<Roster>(needed ? () => get("/api/office/roster") : null, [needed]);
  const employeeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of desks.data?.desks ?? []) map.set(d.employeeId, d.name);
    for (const e of roster.data?.employees ?? []) if (!map.has(e.id)) map.set(e.id, e.name);
    return map;
  }, [desks.data, roster.data]);
  const departmentNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of roster.data?.departments ?? []) map.set(d.id, d.name);
    return map;
  }, [roster.data]);
  const settled = !needed || ((desks.data !== null || desks.error !== null) && (roster.data !== null || roster.error !== null));
  return { employeeNames, departmentNames, settled };
}

export function useEmployeeNames(needed: boolean): ReadonlyMap<string, string> {
  return useGovernanceNames(needed).employeeNames;
}

export function resourceOf(
  resource: string,
  employeeNames?: ReadonlyMap<string, string>,
  departmentNames?: ReadonlyMap<string, string>,
): { label: string; raw: string | null } {
  const direct = employeeNames?.get(resource) ?? departmentNames?.get(resource);
  if (direct) return { label: direct, raw: resource };
  if (resource.startsWith("employee:")) {
    const [empId, ...tail] = resource.slice("employee:".length).split(":");
    const name = empId ? employeeNames?.get(empId) : undefined;
    if (name) return { label: tail.length > 0 ? `${name} · ${tail.join(":")}` : name, raw: resource };
  }
  return { label: resource, raw: null };
}

// Who a record or a decision says acted, by its principal type: the owner (a person), one of the account's agents,
// Orbit Web itself, or somebody nobody verified.
export function principalOf(type: string, id: string, agentId: string | null, employeeNames?: ReadonlyMap<string, string>): string {
  if (type === "human") return tr("governance.parts.principal.you");
  if (type === "agent") {
    const raw = agentId ?? id;
    const name = raw.startsWith("employee:") ? employeeNames?.get(raw.slice("employee:".length)) : undefined;
    if (name) return `${name} (agent)`;
    return tr("governance.parts.principal.agent", { id: short(raw, 16) });
  }
  if (type === "system" || type === "service") return tr("governance.parts.principal.orbitWeb", { id });
  return tr("governance.parts.principal.unverified");
}

export function ErrorBar({ text }: { text: string | null }) {
  if (text === null) return null;
  return (
    <MessageBar intent="error">
      <MessageBarBody>{text}</MessageBarBody>
    </MessageBar>
  );
}
