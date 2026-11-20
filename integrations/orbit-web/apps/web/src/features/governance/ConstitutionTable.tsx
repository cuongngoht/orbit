// THE CONSTITUTION AS A TABLE (packages/governance-core/src/table.ts): a person ticks what may happen instead of writing
// JSON. One row per action, two boxes -- allowed, and a person approves it first; neither ticked is denied. A row whose
// action nobody may ever be granted (nothing carries it out, or it is nobody's at all) cannot be ticked. The hosts the
// agent may reach are a list, the obligations and the default decision are boxes, and a rule the table cannot show is
// listed and kept as written. Every change goes back into the document the page saves, which the server checks as it
// checks any document.
import { Button, Checkbox, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Delete16Regular, LockClosed16Regular } from "@fluentui/react-icons";
import { ACTIONS, CLAUDE_ACCOUNT_HOSTS, boxesOf, effectOf, egressHostOf, tableOf, withTable, type ActionKind, type ActionRow, type Constitution, type ConstitutionTable as TableModel } from "@orbit-web/governance-core";
import { useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { Word, useParts } from "./parts";

const useStyles = makeStyles({
  wrap: { display: "flex", flexDirection: "column", gap: "18px" },
  section: { display: "flex", flexDirection: "column", gap: "10px" },
  dividerSection: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "16px",
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
  },
  action: { display: "flex", flexDirection: "column", gap: "2px", paddingTop: "6px", paddingBottom: "6px" },
  actionSummary: { fontWeight: tokens.fontWeightMedium },
  id: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
  note: { color: tokens.colorNeutralForeground3, lineHeight: "1.45" },
  colAction: { minWidth: "240px", width: "36%" },
  colHeld: { width: "108px", whiteSpace: "nowrap" },
  colAllowed: { width: "84px", textAlign: "center" },
  colApprove: { width: "148px", textAlign: "center" },
  colNote: { minWidth: "180px" },
  readOnlyCheck: {
    "& .fui-Checkbox__label": { color: tokens.colorNeutralForeground2 },
    "& .fui-Checkbox__indicator": { opacity: 0.78 },
  },
  mobileList: { display: "flex", flexDirection: "column", gap: "8px" },
  mobileRow: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "12px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    paddingRight: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  mobileTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px" },
  mobileTitle: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1 },
  mobileChecks: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "8px",
    paddingTop: "2px",
  },
  mobileCheck: { minHeight: "40px" },
  hosts: { display: "flex", flexWrap: "wrap", gap: "6px" },
  host: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: tokens.fontFamilyMonospace,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: "9999px",
    paddingTop: "4px",
    paddingBottom: "4px",
    paddingLeft: "12px",
    paddingRight: "8px",
  },
  add: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", maxWidth: "460px" },
  addInput: {
    flexGrow: 1,
    minWidth: "200px",
    minHeight: "36px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
  },
  addBtn: {
    minHeight: "36px",
    borderRadius: "10px",
    "@media (max-width: 639px), (pointer: coarse)": { minHeight: "42px" },
  },
});

const CLAUDE = new Set(CLAUDE_ACCOUNT_HOSTS.map((h) => `${h.host}:${h.port}`));

// Why a row cannot be ticked, or what its ticks mean for an agent: read from the action's own row of the vocabulary.
function limitOf(action: ActionKind): { fixed: boolean; note: string | null } {
  const spec = ACTIONS[action];
  const ceiling: Partial<Record<string, string>> = spec.ceiling;
  if (spec.enforcement === "none") return { fixed: true, note: "Nothing in Orbit Web carries this out: always denied." };
  if (ceiling.human === "deny" && ceiling.agent === "deny") return { fixed: true, note: "Nobody, whatever is ticked." };
  if (ceiling.agent === "deny") return { fixed: false, note: "Never an agent: what is ticked applies to people." };
  if (ceiling.agent === "require_approval") return { fixed: false, note: "An agent always waits for a person's approval of exactly the action." };
  if (action === "network.egress") return { fixed: false, note: "Any host not in the list below." };
  if (action === "repository.push") return { fixed: false, note: "Allowed alone: the agent pushes the chat's own branch itself, at once (another branch waits for a person) -- never forced, never to the default or a protected branch." };
  return { fixed: false, note: null };
}

function Row({ row, editable, onChange }: { row: ActionRow; editable: boolean; onChange: (row: ActionRow) => void }) {
  const s = useStyles();
  const spec = ACTIONS[row.action];
  const limit = limitOf(row.action);
  const boxes = boxesOf(row.effect);
  const locked = !editable || limit.fixed;
  const set = (allowed: boolean, approval: boolean) => onChange({ ...row, effect: effectOf(allowed, approval), stated: true });
  return (
    <TableRow>
      <TableCell className={s.colAction}>
        <div className={s.action}>
          <Text className={s.actionSummary}>{spec.summary}</Text>
          <span className={s.id}>
            {row.action}
            {row.stated ? "" : " · the default decision"}
          </span>
        </div>
      </TableCell>
      <TableCell className={s.colHeld}>
        <Word value={spec.enforcement} />
      </TableCell>
      <TableCell className={s.colAllowed}>
        <Checkbox className={locked ? s.readOnlyCheck : undefined} checked={boxes.allowed} disabled={locked} onChange={(_, d) => set(d.checked === true, false)} aria-label={`Allowed: ${row.action}`} />
      </TableCell>
      <TableCell className={s.colApprove}>
        <Checkbox className={locked ? s.readOnlyCheck : undefined} checked={boxes.approval} disabled={locked} onChange={(_, d) => set(true, d.checked === true)} aria-label={`A person approves first: ${row.action}`} />
      </TableCell>
      <TableCell className={s.colNote}>
        <Text size={200} className={s.note}>
          {limit.note ?? ""}
        </Text>
      </TableCell>
    </TableRow>
  );
}

function MobileRow({ row, editable, onChange }: { row: ActionRow; editable: boolean; onChange: (row: ActionRow) => void }) {
  const s = useStyles();
  const spec = ACTIONS[row.action];
  const limit = limitOf(row.action);
  const boxes = boxesOf(row.effect);
  const locked = !editable || limit.fixed;
  const set = (allowed: boolean, approval: boolean) => onChange({ ...row, effect: effectOf(allowed, approval), stated: true });
  return (
    <div className={s.mobileRow}>
      <div className={s.mobileTop}>
        <div className={s.mobileTitle}>
          <Text weight="semibold">{spec.summary}</Text>
          <span className={s.id}>
            {row.action}
            {row.stated ? "" : " · the default decision"}
          </span>
        </div>
        <Word value={spec.enforcement} />
      </div>
      <div className={s.mobileChecks}>
        <Checkbox className={mergeClasses(s.mobileCheck, locked && s.readOnlyCheck)} label="Allowed" checked={boxes.allowed} disabled={locked} onChange={(_, d) => set(d.checked === true, false)} aria-label={`Allowed: ${row.action}`} />
        <Checkbox className={mergeClasses(s.mobileCheck, locked && s.readOnlyCheck)} label="Approve first" checked={boxes.approval} disabled={locked} onChange={(_, d) => set(true, d.checked === true)} aria-label={`A person approves first: ${row.action}`} />
      </div>
      {limit.note && (
        <Text size={200} className={s.note}>
          {limit.note}
        </Text>
      )}
    </div>
  );
}

function Hosts({ hosts, editable, onChange }: { hosts: string[]; editable: boolean; onChange: (hosts: string[]) => void }) {
  const s = useStyles();
  const [text, setText] = useState("");
  const host = egressHostOf(text);
  const add = () => {
    if (host === null || hosts.includes(host)) return;
    onChange([...hosts, host]);
    setText("");
  };
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">Hosts the agent may reach</Text>
      <Text size={200} className={s.note}>
        Through the egress proxy, in the governed deployment. Claude Code's own service is always listed: without it no run can reach the model.
      </Text>
      <div className={s.hosts} aria-label="Hosts the agent may reach">
        {hosts.length === 0 && <Text className={s.note}>None.</Text>}
        {hosts.map((h) => (
          <div key={h} className={s.host}>
            <Text size={200}>{h}</Text>
            {CLAUDE.has(h) ? (
              <LockClosed16Regular aria-label="Claude Code's own service" />
            ) : (
              editable && <Button size="small" appearance="transparent" icon={<Delete16Regular />} aria-label={`Remove ${h}`} onClick={() => onChange(hosts.filter((x) => x !== h))} />
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className={s.add}>
          <Input className={s.addInput} value={text} onChange={(_, d) => setText(d.value)} placeholder="registry.npmjs.org:443" aria-label="Host to allow" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button className={s.addBtn} onClick={add} disabled={host === null || hosts.includes(host)}>
            Add host
          </Button>
        </div>
      )}
      {editable && text.trim() !== "" && host === null && (
        <Text size={200} className={s.note}>
          A host and its port: name:port.
        </Text>
      )}
    </div>
  );
}

export function ConstitutionTable({ document, editable, onChange }: { document: Constitution; editable: boolean; onChange: (next: Constitution) => void }) {
  const s = useStyles();
  const parts = useParts();
  const { isMobile } = useViewport();
  const table = tableOf(document);
  const write = (next: TableModel) => onChange(withTable(document, next));
  const setRow = (row: ActionRow) => write({ ...table, rows: table.rows.map((r) => (r.action === row.action ? row : r)) });
  const o = table.obligations;
  const roClass = !editable ? s.readOnlyCheck : undefined;
  return (
    <div className={s.wrap}>
      <div className={s.section}>
        <Text weight="semibold">What may happen</Text>
        {isMobile ? (
          <div className={s.mobileList} aria-label="What may happen">
            {table.rows.map((row) => (
              <MobileRow key={row.action} row={row} editable={editable} onChange={setRow} />
            ))}
          </div>
        ) : (
          <div className={parts.tableWrap}>
            <Table size="small" aria-label="What may happen">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={s.colAction}>Action</TableHeaderCell>
                  <TableHeaderCell className={s.colHeld}>Held by</TableHeaderCell>
                  <TableHeaderCell className={s.colAllowed}>Allowed</TableHeaderCell>
                  <TableHeaderCell className={s.colApprove}>A person approves first</TableHeaderCell>
                  <TableHeaderCell className={s.colNote} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((row) => (
                  <Row key={row.action} row={row} editable={editable} onChange={setRow} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <Hosts hosts={table.egressHosts} editable={editable} onChange={(egressHosts) => write({ ...table, egressHosts })} />
      <div className={s.dividerSection}>
        <Text weight="semibold">Obligations</Text>
        <div className={parts.inset}>
          <Checkbox
            className={roClass}
            label="Anything no rule speaks about waits for a person's approval (unticked: it is denied)"
            checked={table.defaultDecision === "require_approval"}
            disabled={!editable}
            onChange={(_, d) => write({ ...table, defaultDecision: d.checked === true ? "require_approval" : "deny" })}
          />
          <Checkbox
            className={roClass}
            label="Record every decision in the audit record (unticked: only those that did not simply allow)"
            checked={o.auditDecisions === "all"}
            disabled={!editable}
            onChange={(_, d) => write({ ...table, obligations: { ...o, auditDecisions: d.checked === true ? "all" : "non_allow" } })}
          />
          <Checkbox className={roClass} label="Write a daily audit report" checked={o.dailyReport} disabled={!editable} onChange={(_, d) => write({ ...table, obligations: { ...o, dailyReport: d.checked === true } })} />
          <Checkbox
            className={roClass}
            label="A governed run starts only where the agent's isolation was proven"
            checked={o.isolation === "required"}
            disabled={!editable}
            onChange={(_, d) => write({ ...table, obligations: { ...o, isolation: d.checked === true ? "required" : "optional" } })}
          />
        </div>
      </div>
      {table.kept.length > 0 && (
        <div className={s.dividerSection}>
          <Text weight="semibold">Rules the table does not show</Text>
          <Text size={200} className={s.note}>
            Kept exactly as written.
          </Text>
          <div className={parts.inset}>
            <ul className={parts.list} aria-label="Rules the table does not show">
              {table.kept.map((r) => (
                <li key={r.id}>
                  <Text size={200}>
                    <span className={s.id}>{r.id}</span> · {r.action}
                    {r.principalType ? ` · for ${r.principalType === "human" ? "people" : `${r.principalType}s`}` : ""}
                    {r.environment ? ` · in ${r.environment}` : ""}
                    {r.resource ? ` · on ${r.resource}` : ""} · <Word value={r.effect} />
                  </Text>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
