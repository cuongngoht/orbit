// THE AUDIT TIMELINE: every record of the account's governance, newest first, each with everything it says -- who (you,
// one of your agents, nobody verified, Orbit Web itself), the chat or research workspace, the run, the revision and
// decision it stands on, why, and its place in the account's hash chain. Read only: no page and no route changes or
// removes a record.
import {
  Button,
  MessageBar,
  MessageBarBody,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  SearchBox,
  Spinner,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import {
  Checkmark16Regular,
  ChevronDown16Regular,
  ChevronUp16Regular,
  Copy16Regular,
  Dismiss16Regular,
  Filter16Regular,
  ShieldCheckmark16Regular,
} from "@fluentui/react-icons";
import { AUDIT_EVENTS, type AuditEvent } from "@orbit-web/governance-core";
import type { AuditPage as Page, ChainVerification } from "@orbit-web/contracts";
import { useEffect, useMemo, useState } from "react";
import { AuditChainIcon } from "../../components/SectionIcons";
import { useResource } from "../../hooks/useResource";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, ErrorBar, Word, byWhom, hasEmployeeRef, plural, principalOf, resourceOf, short, useGovernanceNames, useParts, when } from "./parts";

const CATEGORY_KEY_OF_PREFIX: Record<string, MessageKey> = {
  account: "governance.audit.cat.account",
  auth: "governance.audit.cat.account",
  authz: "governance.audit.cat.account",
  boundary: "governance.audit.cat.account",
  policy: "governance.audit.cat.policy",
  override: "governance.audit.cat.policy",
  approval: "governance.audit.cat.approvals",
  protected: "governance.audit.cat.approvals",
  run: "governance.audit.cat.runs",
  isolation: "governance.audit.cat.runs",
  egress: "governance.audit.cat.runs",
  office: "governance.audit.cat.office",
  audit: "governance.audit.cat.audit",
  finding: "governance.audit.cat.audit",
  report: "governance.audit.cat.audit",
  settings: "governance.audit.cat.audit",
  resource: "governance.audit.cat.audit",
};

const CATEGORY_KEY_ORDER: readonly MessageKey[] = [
  "governance.audit.cat.account",
  "governance.audit.cat.policy",
  "governance.audit.cat.approvals",
  "governance.audit.cat.runs",
  "governance.audit.cat.office",
  "governance.audit.cat.audit",
];

interface EventOption {
  value: string;
  summary: string;
  category: string;
}

function categoryFor(eventType: string): string {
  const prefix = eventType.split(".")[0] ?? "";
  if (CATEGORY_KEY_OF_PREFIX[prefix]) return tr(CATEGORY_KEY_OF_PREFIX[prefix]);
  return prefix ? `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}` : tr("governance.audit.cat.other");
}

const ALL_EVENT_OPTIONS: EventOption[] = (Object.keys(AUDIT_EVENTS) as Array<keyof typeof AUDIT_EVENTS>).map((evType) => ({
  value: evType,
  summary: AUDIT_EVENTS[evType].summary,
  category: categoryFor(evType),
}));

const useStyles = makeStyles({
  cardOk: { borderLeftWidth: "3px", borderLeftColor: tokens.colorPaletteGreenBorder2 },
  cardDeny: { borderLeftWidth: "3px", borderLeftColor: tokens.colorPaletteRedBorder2 },
  cardInfo: { borderLeftWidth: "3px", borderLeftColor: tokens.colorNeutralStroke1 },
  toolbarLeft: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", minWidth: 0 },
  pickerBtn: {
    minWidth: "210px",
    maxWidth: "min(360px, 85vw)",
    justifyContent: "space-between",
    fontWeight: tokens.fontWeightRegular,
    backgroundColor: "var(--orbit-card-bg)",
  },
  pickerBtnActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  pickerBtnInner: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
    overflow: "hidden",
  },
  pickerBtnLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  popoverSurface: {
    width: "min(420px, 92vw)",
    maxHeight: "420px",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    paddingTop: "10px",
    paddingRight: "10px",
    paddingBottom: "10px",
    paddingLeft: "10px",
    gap: "8px",
    borderRadius: "14px",
  },
  optionList: {
    overflowY: "auto",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingRight: "2px",
  },
  groupHead: {
    paddingTop: "8px",
    paddingRight: "8px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    fontSize: "11px",
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: tokens.colorNeutralForeground3,
  },
  optionBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "2px",
    width: "100%",
    textAlign: "left",
    paddingTop: "7px",
    paddingRight: "10px",
    paddingBottom: "7px",
    paddingLeft: "10px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", "transparent"),
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    fontFamily: "inherit",
    transitionProperty: "background-color, border-color",
    transitionDuration: "120ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "1px",
    },
  },
  optionBtnSelected: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    ...shorthands.borderColor(tokens.colorBrandStroke2),
  },
  optionTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minWidth: 0,
  },
  optionSummary: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  checkIcon: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  reasonRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  expandedBox: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  expandedHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
  },
});

const OK_OUTCOMES = new Set(["allow", "ok", "succeeded", "signed_in", "granted", "created", "consumed", "resolved"]);
const DENY_OUTCOMES = new Set(["deny", "refused", "failed", "rejected"]);

function EventTypePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const st = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const grouped = useMemo(() => {
    const filtered = needle
      ? ALL_EVENT_OPTIONS.filter((opt) => opt.value.toLowerCase().includes(needle) || opt.summary.toLowerCase().includes(needle) || opt.category.toLowerCase().includes(needle))
      : ALL_EVENT_OPTIONS;
    const byCat = new Map<string, EventOption[]>();
    for (const opt of filtered) {
      const list = byCat.get(opt.category) ?? [];
      list.push(opt);
      byCat.set(opt.category, list);
    }
    const baseOrder = CATEGORY_KEY_ORDER.map((k) => t(k));
    const order = [...baseOrder, ...Array.from(byCat.keys()).filter((c) => !baseOrder.includes(c))];
    return order.map((cat) => ({ category: cat, items: byCat.get(cat) ?? [] })).filter((g) => g.items.length > 0);
  }, [needle, t]);

  const showAllOption = !needle || t("governance.audit.everyRecordLower").includes(needle);
  const pick = (next: string) => {
    onChange(next);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => {
        setOpen(data.open);
        if (!data.open) setQuery("");
      }}
      positioning="below-start"
    >
      <PopoverTrigger disableButtonEnhancement>
        <Button
          aria-label={t("governance.audit.recordTypeAria")}
          appearance="outline"
          shape="circular"
          className={mergeClasses(st.pickerBtn, value !== "" && st.pickerBtnActive)}
          icon={<ChevronDown16Regular />}
          iconPosition="after"
        >
          <span className={st.pickerBtnInner}>
            <Filter16Regular aria-hidden style={{ flexShrink: 0 }} />
            <span className={mergeClasses(st.pickerBtnLabel, value !== "" && s.mono)}>{value || t("governance.audit.everyRecord")}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverSurface className={st.popoverSurface} aria-label={t("governance.audit.filterTypesAria")}>
        <SearchBox
          placeholder={t("governance.audit.searchPlaceholder")}
          aria-label={t("governance.audit.searchAria")}
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          autoFocus
        />
        <div className={st.optionList} role="listbox" aria-label={t("governance.audit.optionsAria")}>
          {showAllOption && (
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              className={mergeClasses(st.optionBtn, value === "" && st.optionBtnSelected)}
              onClick={() => pick("")}
            >
              <span className={st.optionTop}>
                <Text weight="semibold" size={200}>
                  {t("governance.audit.everyRecord")}
                </Text>
                {value === "" && <Checkmark16Regular className={st.checkIcon} aria-hidden />}
              </span>
              <span className={st.optionSummary}>{t("governance.audit.showAllTypes", { count: ALL_EVENT_OPTIONS.length })}</span>
            </button>
          )}
          {grouped.length === 0 && !showAllOption ? (
            <Text size={200} className={s.muted} style={{ padding: "12px 8px", textAlign: "center" }}>
              {t("governance.audit.noMatch", { query: query.trim() })}
            </Text>
          ) : (
            grouped.map((g) => (
              <div key={g.category}>
                <div className={st.groupHead}>{g.category}</div>
                {g.items.map((opt) => {
                  const selected = value === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={mergeClasses(st.optionBtn, selected && st.optionBtnSelected)}
                      onClick={() => pick(opt.value)}
                    >
                      <span className={st.optionTop}>
                        <Text weight="semibold" size={200} className={s.mono}>
                          {opt.value}
                        </Text>
                        {selected && <Checkmark16Regular className={st.checkIcon} aria-hidden />}
                      </span>
                      <span className={st.optionSummary}>{opt.summary}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverSurface>
    </Popover>
  );
}

const EMPLOYEE_DATA_KEYS = new Set(["employeeId", "employee", "from", "target", "resource", "workspace"]);
const DEPARTMENT_DATA_KEYS = new Set(["departmentId", "department"]);
const ACTOR_DATA_KEYS = new Set(["startedBy", "startedByLabel", "by", "requestedBy"]);

function stripEmployeePrefix(raw: string): string {
  if (raw.startsWith("agent:employee:")) return raw.slice("agent:employee:".length);
  if (raw.startsWith("employee:")) return raw.slice("employee:".length).split(":")[0] ?? raw;
  return raw;
}

function auditEmployeeIdsOf(ev: AuditEvent): string[] {
  const ids: string[] = [];
  if (hasEmployeeRef(ev.workspaceId)) ids.push(stripEmployeePrefix(ev.workspaceId!));
  const data = (ev.data ?? {}) as Record<string, unknown>;
  for (const key of EMPLOYEE_DATA_KEYS) {
    const val = data[key];
    if (typeof val === "string" && hasEmployeeRef(val)) ids.push(stripEmployeePrefix(val));
  }
  for (const key of DEPARTMENT_DATA_KEYS) {
    const val = data[key];
    if (typeof val === "string" && hasEmployeeRef(val)) ids.push(val);
  }
  return ids;
}

function formatAuditKey(key: string, trFn: (k: MessageKey) => string): string {
  if (key === "employeeId" || key === "employee") return trFn("governance.audit.employeeField");
  if (key === "departmentId" || key === "department") return "Department";
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b(Ki|Mi|Gi) B\b/g, "$1B")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatAuditValue(
  key: string,
  val: unknown,
  employeeNames?: ReadonlyMap<string, string>,
  departmentNames?: ReadonlyMap<string, string>,
): { text: string; raw?: string } {
  if (val === null || val === undefined) return { text: "—" };
  if (typeof val === "object") return { text: JSON.stringify(val) };
  const s = String(val);
  if (DEPARTMENT_DATA_KEYS.has(key)) {
    const dept = departmentNames?.get(s);
    return dept ? { text: dept, raw: s } : { text: s };
  }
  if (EMPLOYEE_DATA_KEYS.has(key)) {
    const res = resourceOf(s, employeeNames, departmentNames);
    return res.raw !== null ? { text: res.label, raw: res.raw } : { text: s };
  }
  if (ACTOR_DATA_KEYS.has(key)) {
    const actor = byWhom(s, employeeNames);
    return actor !== s ? { text: actor, raw: s } : { text: s };
  }
  return { text: s };
}

function auditWorkspaceOrEmployeeSuffix(event: AuditEvent, employeeNames: ReadonlyMap<string, string> | undefined, trFn: ReturnType<typeof useI18n>["t"]): string {
  if (event.workspaceId) {
    const empName = employeeNames?.get(event.workspaceId);
    if (empName) {
      return (event.agentId ?? event.principalId) === `employee:${event.workspaceId}` ? "" : ` · ${empName}`;
    }
    return trFn("governance.audit.workspaceSuffix", { id: short(event.workspaceId, 8) });
  }
  if (event.principalType !== "agent") {
    for (const empId of auditEmployeeIdsOf(event)) {
      const name = employeeNames?.get(empId);
      if (name) return ` · ${name}`;
    }
  }
  return "";
}

function Record({
  event,
  open: initiallyOpen,
  employeeNames,
  departmentNames,
}: {
  event: AuditEvent;
  open: boolean;
  employeeNames?: ReadonlyMap<string, string>;
  departmentNames?: ReadonlyMap<string, string>;
}) {
  const { t } = useI18n();
  const s = useParts();
  const st = useStyles();
  const [open, setOpen] = useState(initiallyOpen);
  const [copied, setCopied] = useState(false);
  const accent = OK_OUTCOMES.has(event.outcome) ? st.cardOk : DENY_OUTCOMES.has(event.outcome) ? st.cardDeny : st.cardInfo;
  const summary = Object.hasOwn(AUDIT_EVENTS, event.eventType) ? AUDIT_EVENTS[event.eventType as keyof typeof AUDIT_EVENTS].summary : null;
  const copyJson = () => {
    void navigator.clipboard?.writeText(JSON.stringify(event, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  const dataEntries = Object.entries((event.data ?? {}) as Record<string, unknown>);
  return (
    <li id={event.eventId} aria-label={event.eventType}>
      <Card className={accent}>
        <div className={s.between}>
          <div className={s.row}>
            <span className={s.codeChip}>#{event.seq}</span>
            <Text size={200} className={s.muted}>
              {when(event.occurredAt)}
            </Text>
            <Text weight="semibold" className={s.mono}>
              {event.eventType}
            </Text>
            <Word value={event.outcome} label={event.outcome} />
          </div>
          <Button
            size="small"
            appearance="secondary"
            shape="circular"
            icon={open ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
            iconPosition="after"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? t("governance.audit.less") : t("governance.audit.everythingItSays")}
          </Button>
        </div>
        <div className={st.reasonRow}>
          {summary && <Text size={200}>{summary}</Text>}
          <Text size={200} className={s.muted}>
            {principalOf(event.principalType, event.principalId, event.agentId, employeeNames)}
            {auditWorkspaceOrEmployeeSuffix(event, employeeNames, t)}
          </Text>
          {event.reasonCodes.map((code) => (
            <span key={code} className={s.codeChip}>
              {code}
            </span>
          ))}
        </div>
        {open && (
          <div className={st.expandedBox}>
            <div className={st.expandedHead}>
              {summary ? (
                <Text size={200} className={s.muted}>
                  {summary}
                </Text>
              ) : (
                <span />
              )}
              <Button size="small" appearance="subtle" shape="circular" icon={<Copy16Regular />} onClick={copyJson}>
                {copied ? t("governance.audit.copied") : t("governance.audit.copyJson")}
              </Button>
            </div>
            {dataEntries.length > 0 && (
              <div className={s.inset}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <tbody>
                    {dataEntries.map(([k, v]) => {
                      const formatted = formatAuditValue(k, v, employeeNames, departmentNames);
                      return (
                        <tr key={k}>
                          <td style={{ paddingRight: 14, paddingTop: 3, paddingBottom: 3, verticalAlign: "top", width: "150px" }}>
                            <Text size={200} className={s.muted}>
                              {formatAuditKey(k, t)}
                            </Text>
                          </td>
                          <td style={{ paddingTop: 3, paddingBottom: 3 }}>
                            <Text size={200} title={formatted.raw}>
                              {formatted.text}
                            </Text>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <details>
              <summary style={{ cursor: "pointer", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                {t("governance.audit.rawJson")}
              </summary>
              <pre className={s.pre} style={{ marginTop: "6px" }}>
                {JSON.stringify(event, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Card>
    </li>
  );
}

export function AuditPage({ item }: { item: string | null }) {
  const { t } = useI18n();
  const s = useParts();
  const st = useStyles();
  const [type, setType] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<number | null>>([]);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = useResource<AuditEvent>(item ? () => get(`/api/governance/audit/${encodeURIComponent(item)}`) : null, [item]);
  const page = useResource<Page>(() => get(`/api/governance/audit?limit=50${type ? `&type=${type}` : ""}${before !== null ? `&before=${before}` : ""}`), [type, before]);
  const needsNames = [...(one.data ? [one.data] : []), ...(page.data?.events ?? [])].some(
    (ev) => hasEmployeeRef(ev.agentId ?? ev.principalId) || auditEmployeeIdsOf(ev).length > 0,
  );
  const { employeeNames, departmentNames, settled: namesSettled } = useGovernanceNames(true);
  useAppEvent("governance.changed", (e) => e.data.area === "audit" && before === null && void page.reload());
  useEffect(() => {
    if (item) document.getElementById(item)?.scrollIntoView({ block: "center" });
  }, [item, one.data]);
  const verify = () => {
    setError(null);
    setVerifying(true);
    void send<ChainVerification>("POST", "/api/governance/audit/verify")
      .then(setVerification)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setVerifying(false));
  };
  return (
    <div className={s.page}>
      <div className={s.toolbarBar}>
        <div className={st.toolbarLeft}>
          <EventTypePicker
            value={type}
            onChange={(value) => {
              setBefore(null);
              setCursorStack([]);
              setType(value);
            }}
          />
          {type !== "" && (
            <Button
              size="small"
              appearance="subtle"
              shape="circular"
              icon={<Dismiss16Regular />}
              onClick={() => {
                setBefore(null);
                setCursorStack([]);
                setType("");
              }}
            >
              {t("governance.audit.clear")}
            </Button>
          )}
          {page.data && (
            <Text size={200} className={s.muted}>
              {plural(page.data.events.length, t("governance.audit.recordOne"), t("governance.audit.recordMany"))}
              {page.data.events.length > 0 ? ` (#${page.data.events[page.data.events.length - 1].seq}–#${page.data.events[0].seq})` : ""}
            </Text>
          )}
        </div>
        <Button shape="circular" icon={<ShieldCheckmark16Regular />} disabled={verifying} onClick={verify}>
          {verifying ? t("governance.audit.verifying") : t("governance.audit.verifyChain")}
        </Button>
      </div>
      {verification && (
        <MessageBar intent={verification.ok ? "success" : "error"}>
          <MessageBarBody>
            {verification.ok
              ? t("governance.audit.chainOk", {
                  records: plural(verification.count, t("governance.audit.recordOne"), t("governance.audit.recordMany")),
                  head: short(verification.head, 16),
                })
              : t("governance.audit.chainBroken", { at: verification.brokenAt ?? "", problem: verification.problem ?? "" })}
          </MessageBarBody>
        </MessageBar>
      )}
      <ErrorBar text={error} />
      {item && one.data && (!needsNames || namesSettled) && (
        <ul className={s.list} aria-label={t("governance.audit.requestedRecordAria")}>
          <Record event={one.data} open employeeNames={employeeNames} departmentNames={departmentNames} />
        </ul>
      )}
      {page.error ? (
        <MessageBar intent="error">
          <MessageBarBody>{page.error}</MessageBarBody>
        </MessageBar>
      ) : page.data === null || (needsNames && !namesSettled) ? (
        <Spinner />
      ) : (
        <>
          {page.data.events.length === 0 ? (
            <EmptyState
              icon={<AuditChainIcon size={22} />}
              tone="teal"
              title={type ? t("governance.audit.emptyMatchingTitle") : t("governance.audit.emptyTitle")}
              body={type ? t("governance.audit.emptyMatchingBody", { type }) : t("governance.audit.emptyBody")}
              action={
                type ? (
                  <Button
                    shape="circular"
                    onClick={() => {
                      setBefore(null);
                      setCursorStack([]);
                      setType("");
                    }}
                  >
                    {t("governance.audit.showEveryRecord")}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className={mergeClasses(s.list)} aria-label={t("governance.audit.recordsAria")}>
              {page.data.events.map((e) => (
                <Record key={e.eventId} event={e} open={false} employeeNames={employeeNames} departmentNames={departmentNames} />
              ))}
            </ul>
          )}
          <div className={s.row}>
            {before !== null && (
              <Button
                shape="circular"
                onClick={() => {
                  setBefore(null);
                  setCursorStack([]);
                }}
              >
                {t("governance.audit.newest")}
              </Button>
            )}
            {cursorStack.length > 0 && (
              <Button
                shape="circular"
                onClick={() => {
                  const prev = cursorStack[cursorStack.length - 1] ?? null;
                  setCursorStack((st) => st.slice(0, -1));
                  setBefore(prev);
                }}
              >
                {t("governance.audit.newer")}
              </Button>
            )}
            {page.data.next !== null && (
              <Button
                shape="circular"
                onClick={() => {
                  setCursorStack((st) => [...st, before]);
                  setBefore(page.data?.next ?? null);
                }}
              >
                {t("governance.audit.older")}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
