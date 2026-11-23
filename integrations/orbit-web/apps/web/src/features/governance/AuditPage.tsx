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
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, EmptyState, ErrorBar, Word, plural, principalOf, short, useParts, when } from "./parts";

const CATEGORY_OF_PREFIX: Record<string, string> = {
  account: "Account & Auth",
  auth: "Account & Auth",
  authz: "Account & Auth",
  boundary: "Account & Auth",
  policy: "Policy & Overrides",
  override: "Policy & Overrides",
  approval: "Approvals & Protected",
  protected: "Approvals & Protected",
  run: "Runs & Isolation",
  isolation: "Runs & Isolation",
  egress: "Runs & Isolation",
  office: "Office",
  audit: "Audit, Findings & Settings",
  finding: "Audit, Findings & Settings",
  report: "Audit, Findings & Settings",
  settings: "Audit, Findings & Settings",
  resource: "Audit, Findings & Settings",
};

const CATEGORY_ORDER = [
  "Account & Auth",
  "Policy & Overrides",
  "Approvals & Protected",
  "Runs & Isolation",
  "Office",
  "Audit, Findings & Settings",
] as const;

interface EventOption {
  value: string;
  summary: string;
  category: string;
}

function categoryFor(eventType: string): string {
  const prefix = eventType.split(".")[0] ?? "";
  if (CATEGORY_OF_PREFIX[prefix]) return CATEGORY_OF_PREFIX[prefix]!;
  return prefix ? `${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}` : "Other";
}

const ALL_EVENT_OPTIONS: EventOption[] = (Object.keys(AUDIT_EVENTS) as Array<keyof typeof AUDIT_EVENTS>).map((t) => ({
  value: t,
  summary: AUDIT_EVENTS[t].summary,
  category: categoryFor(t),
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
    const order = [...CATEGORY_ORDER, ...Array.from(byCat.keys()).filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c))];
    return order.map((cat) => ({ category: cat, items: byCat.get(cat) ?? [] })).filter((g) => g.items.length > 0);
  }, [needle]);

  const showAllOption = !needle || "every record".includes(needle);
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
          aria-label="Record type"
          appearance="outline"
          shape="circular"
          className={mergeClasses(st.pickerBtn, value !== "" && st.pickerBtnActive)}
          icon={<ChevronDown16Regular />}
          iconPosition="after"
        >
          <span className={st.pickerBtnInner}>
            <Filter16Regular aria-hidden style={{ flexShrink: 0 }} />
            <span className={mergeClasses(st.pickerBtnLabel, value !== "" && s.mono)}>{value || "Every record"}</span>
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverSurface className={st.popoverSurface} aria-label="Filter record types">
        <SearchBox
          placeholder="Search record types…"
          aria-label="Search record types"
          value={query}
          onChange={(_, d) => setQuery(d.value)}
          autoFocus
        />
        <div className={st.optionList} role="listbox" aria-label="Record type options">
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
                  Every record
                </Text>
                {value === "" && <Checkmark16Regular className={st.checkIcon} aria-hidden />}
              </span>
              <span className={st.optionSummary}>Show all {ALL_EVENT_OPTIONS.length} audit record types</span>
            </button>
          )}
          {grouped.length === 0 && !showAllOption ? (
            <Text size={200} className={s.muted} style={{ padding: "12px 8px", textAlign: "center" }}>
              No record type matches “{query.trim()}”.
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

function Record({ event, open: initiallyOpen }: { event: AuditEvent; open: boolean }) {
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
            {open ? "Less" : "Everything it says"}
          </Button>
        </div>
        <div className={st.reasonRow}>
          <Text size={200} className={s.muted}>
            {principalOf(event.principalType, event.principalId, event.agentId)}
            {event.workspaceId ? ` · workspace ${short(event.workspaceId, 8)}` : ""}
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
                {copied ? "Copied" : "Copy JSON"}
              </Button>
            </div>
            <pre className={s.pre}>{JSON.stringify(event, null, 2)}</pre>
          </div>
        )}
      </Card>
    </li>
  );
}

export function AuditPage({ item }: { item: string | null }) {
  const s = useParts();
  const st = useStyles();
  const [type, setType] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const one = useResource<AuditEvent>(item ? () => get(`/api/governance/audit/${encodeURIComponent(item)}`) : null, [item]);
  const page = useResource<Page>(() => get(`/api/governance/audit?limit=50${type ? `&type=${type}` : ""}${before !== null ? `&before=${before}` : ""}`), [type, before]);
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
                setType("");
              }}
            >
              Clear
            </Button>
          )}
          {page.data && (
            <Text size={200} className={s.muted}>
              {plural(page.data.events.length, "record")}
            </Text>
          )}
        </div>
        <Button shape="circular" icon={<ShieldCheckmark16Regular />} disabled={verifying} onClick={verify}>
          {verifying ? "Verifying…" : "Verify the chain"}
        </Button>
      </div>
      {verification && (
        <MessageBar intent={verification.ok ? "success" : "error"}>
          <MessageBarBody>{verification.ok ? `The chain holds: ${plural(verification.count, "record")}, head ${short(verification.head, 16)}.` : `The chain does NOT hold at record ${verification.brokenAt} (${verification.problem}).`}</MessageBarBody>
        </MessageBar>
      )}
      <ErrorBar text={error} />
      {item && one.data && (
        <ul className={s.list} aria-label="The record asked for">
          <Record event={one.data} open />
        </ul>
      )}
      {page.data === null ? (
        page.error ? (
          <MessageBar intent="error">
            <MessageBarBody>{page.error}</MessageBarBody>
          </MessageBar>
        ) : (
          <Spinner />
        )
      ) : (
        <>
          {page.data.events.length === 0 ? (
            <EmptyState
              icon={<AuditChainIcon size={22} />}
              tone="teal"
              title={type ? "No matching audit records" : "No audit records yet"}
              body={type ? `Nothing recorded for ${type} on this page.` : "Governance actions will appear here as they happen."}
              action={
                type ? (
                  <Button
                    shape="circular"
                    onClick={() => {
                      setBefore(null);
                      setType("");
                    }}
                  >
                    Show every record
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className={mergeClasses(s.list)} aria-label="Audit records">
              {page.data.events.map((e) => (
                <Record key={e.eventId} event={e} open={false} />
              ))}
            </ul>
          )}
          <div className={s.row}>
            {before !== null && (
              <Button shape="circular" onClick={() => setBefore(null)}>
                Newest
              </Button>
            )}
            {page.data.next !== null && (
              <Button shape="circular" onClick={() => setBefore(page.data?.next ?? null)}>
                Older
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
