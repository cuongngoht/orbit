// THE ACCOUNT'S POLICY AS A TABLE (packages/governance-core/src/table.ts): the owner ticks what may happen instead of
// writing JSON. One row per action, two boxes -- allowed, and you approve it first; neither ticked is denied. A row whose
// action nobody may ever be granted (nothing carries it out, or it is nobody's at all) cannot be ticked. A row's rule
// BINDS every department (mandatory, unless said otherwise) or is the company's default for an action it delegated, which
// a department's own answer replaces. The hosts the agent may reach are a list, the obligations and the default decision
// are boxes, and a rule the table cannot show is listed and kept as written. Every change goes back into the document the
// page saves, which the server checks as it checks any document.
import { Button, Checkbox, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Delete16Regular, LockClosed16Regular } from "@fluentui/react-icons";
import { ACTIONS, BINDINGS, CLAUDE_ACCOUNT_HOSTS, boxesOf, effectOf, egressHostOf, tableOf, withTable, type AccountPolicy, type ActionKind, type ActionRow, type Binding, type ConstitutionTable as TableModel } from "@orbit-web/governance-core";
import { useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { CleanSelect, Word, put, useParts } from "./parts";

const usePolicyTableStyles = makeStyles({
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
  colBinding: { width: "136px", whiteSpace: "nowrap" },
  bindingSelect: { minWidth: "124px" },
  mobileBinding: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
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

const BINDING_KEYS: Record<Binding, MessageKey> = {
  mandatory: "governance.policyTable.binding.mandatory",
  default: "governance.policyTable.binding.default",
};

// Whether a row's rule binds every department or is the company's default for an action it delegated: chosen while the
// row may change, said otherwise. A row no rule states follows the default decision, and binds nothing of its own.
function BindingOf({ row, locked, onChange }: { row: ActionRow; locked: boolean; onChange: (row: ActionRow) => void }) {
  const { t } = useI18n();
  const s = usePolicyTableStyles();
  if (!row.stated) return <Text className={s.note}>—</Text>;
  const binding: Binding = row.binding ?? "mandatory";
  if (locked) return <Word value={binding} />;
  return (
    <CleanSelect
      className={s.bindingSelect}
      ariaLabel={t("governance.policyTable.bindingAria", { action: row.action })}
      value={binding}
      options={BINDINGS.map((b) => ({ value: b, label: t(BINDING_KEYS[b]) }))}
      onChange={(v) => onChange(put(row, "binding", v === "default" ? "default" : undefined))}
    />
  );
}

// Why a row cannot be ticked, or what its ticks mean for an agent: read from the action's own row of the vocabulary.
export function limitOf(action: ActionKind): { fixed: boolean; note: string | null } {
  const spec = ACTIONS[action];
  const ceiling: Partial<Record<string, string>> = spec.ceiling;
  if (spec.enforcement === "none") return { fixed: true, note: tr("governance.policyTable.limit.noEnforcement") };
  if (ceiling.human === "deny" && ceiling.agent === "deny") return { fixed: true, note: tr("governance.policyTable.limit.nobody") };
  if (ceiling.agent === "deny") return { fixed: false, note: tr("governance.policyTable.limit.neverAgent") };
  if (ceiling.agent === "require_approval") return { fixed: false, note: tr("governance.policyTable.limit.agentApproval") };
  if (action === "network.egress") return { fixed: false, note: tr("governance.policyTable.limit.egress") };
  if (action === "repository.push") return { fixed: false, note: tr("governance.policyTable.limit.push") };
  return { fixed: false, note: null };
}

function Row({ row, editable, onChange }: { row: ActionRow; editable: boolean; onChange: (row: ActionRow) => void }) {
  const { t } = useI18n();
  const s = usePolicyTableStyles();
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
            {row.stated ? "" : t("governance.policyTable.defaultDecisionSuffix")}
          </span>
        </div>
      </TableCell>
      <TableCell className={s.colHeld}>
        <Word value={spec.enforcement} />
      </TableCell>
      <TableCell className={s.colAllowed}>
        <Checkbox className={locked ? s.readOnlyCheck : undefined} checked={boxes.allowed} disabled={locked} onChange={(_, d) => set(d.checked === true, false)} aria-label={t("governance.policyTable.allowedAria", { action: row.action })} />
      </TableCell>
      <TableCell className={s.colApprove}>
        <Checkbox className={locked ? s.readOnlyCheck : undefined} checked={boxes.approval} disabled={locked} onChange={(_, d) => set(true, d.checked === true)} aria-label={t("governance.policyTable.approveFirstAria", { action: row.action })} />
      </TableCell>
      <TableCell className={s.colBinding}>
        <BindingOf row={row} locked={locked} onChange={onChange} />
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
  const { t } = useI18n();
  const s = usePolicyTableStyles();
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
            {row.stated ? "" : t("governance.policyTable.defaultDecisionSuffix")}
          </span>
        </div>
        <Word value={spec.enforcement} />
      </div>
      <div className={s.mobileChecks}>
        <Checkbox className={mergeClasses(s.mobileCheck, locked && s.readOnlyCheck)} label={t("governance.policyTable.allowedLabel")} checked={boxes.allowed} disabled={locked} onChange={(_, d) => set(d.checked === true, false)} aria-label={t("governance.policyTable.allowedAria", { action: row.action })} />
        <Checkbox className={mergeClasses(s.mobileCheck, locked && s.readOnlyCheck)} label={t("governance.policyTable.approveFirstLabel")} checked={boxes.approval} disabled={locked} onChange={(_, d) => set(true, d.checked === true)} aria-label={t("governance.policyTable.approveFirstAria", { action: row.action })} />
      </div>
      {row.stated && (
        <div className={s.mobileBinding}>
          <Text size={200} className={s.note}>
            {t("governance.policyTable.colBinding")}
          </Text>
          <BindingOf row={row} locked={locked} onChange={onChange} />
        </div>
      )}
      {limit.note && (
        <Text size={200} className={s.note}>
          {limit.note}
        </Text>
      )}
    </div>
  );
}

function Hosts({ hosts, editable, onChange }: { hosts: string[]; editable: boolean; onChange: (hosts: string[]) => void }) {
  const { t } = useI18n();
  const s = usePolicyTableStyles();
  const [text, setText] = useState("");
  const host = egressHostOf(text);
  const add = () => {
    if (host === null || hosts.includes(host)) return;
    onChange([...hosts, host]);
    setText("");
  };
  return (
    <div className={s.dividerSection}>
      <Text weight="semibold">{t("governance.policyTable.hostsTitle")}</Text>
      <Text size={200} className={s.note}>
        {t("governance.policyTable.hostsDesc")}
      </Text>
      <div className={s.hosts} aria-label={t("governance.policyTable.hostsTitle")}>
        {hosts.length === 0 && <Text className={s.note}>{t("governance.policyTable.hostsEmpty")}</Text>}
        {hosts.map((h) => (
          <div key={h} className={s.host}>
            <Text size={200}>{h}</Text>
            {CLAUDE.has(h) ? (
              <LockClosed16Regular aria-label={t("governance.policyTable.claudeServiceAria")} />
            ) : (
              editable && <Button size="small" appearance="transparent" icon={<Delete16Regular />} aria-label={t("governance.network.removeHost", { host: h })} onClick={() => onChange(hosts.filter((x) => x !== h))} />
            )}
          </div>
        ))}
      </div>
      {editable && (
        <div className={s.add}>
          <Input className={s.addInput} value={text} onChange={(_, d) => setText(d.value)} placeholder="registry.npmjs.org:443" aria-label={t("governance.policyTable.hostToAllowAria")} onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button className={s.addBtn} onClick={add} disabled={host === null || hosts.includes(host)}>
            {t("governance.policyTable.addHost")}
          </Button>
        </div>
      )}
      {editable && text.trim() !== "" && host === null && (
        <Text size={200} className={s.note}>
          {t("governance.policyTable.hostFormatHint")}
        </Text>
      )}
    </div>
  );
}

export function PolicyTable({ document, editable, onChange }: { document: AccountPolicy; editable: boolean; onChange: (next: AccountPolicy) => void }) {
  const { t } = useI18n();
  const s = usePolicyTableStyles();
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
        <Text weight="semibold">{t("governance.policyTable.whatMayHappen")}</Text>
        <Text size={200} className={s.note}>
          {t("governance.policyTable.bindingNote")}
        </Text>
        {isMobile ? (
          <div className={s.mobileList} aria-label={t("governance.policyTable.whatMayHappen")}>
            {table.rows.map((row) => (
              <MobileRow key={row.action} row={row} editable={editable} onChange={setRow} />
            ))}
          </div>
        ) : (
          <div className={parts.tableWrap}>
            <Table size="small" aria-label={t("governance.policyTable.whatMayHappen")}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell className={s.colAction}>{t("governance.policy.colAction")}</TableHeaderCell>
                  <TableHeaderCell className={s.colHeld}>{t("governance.policyTable.colHeldBy")}</TableHeaderCell>
                  <TableHeaderCell className={s.colAllowed}>{t("governance.policyTable.colAllowed")}</TableHeaderCell>
                  <TableHeaderCell className={s.colApprove}>{t("governance.policyTable.colYouApprove")}</TableHeaderCell>
                  <TableHeaderCell className={s.colBinding}>{t("governance.policyTable.colBinding")}</TableHeaderCell>
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
        <Text weight="semibold">{t("governance.policyTable.obligationsTitle")}</Text>
        <div className={parts.inset}>
          <Checkbox
            className={roClass}
            label={t("governance.policyTable.obDefaultDecision")}
            checked={table.defaultDecision === "require_approval"}
            disabled={!editable}
            onChange={(_, d) => write({ ...table, defaultDecision: d.checked === true ? "require_approval" : "deny" })}
          />
          <Checkbox
            className={roClass}
            label={t("governance.policyTable.obAuditAll")}
            checked={o.auditDecisions === "all"}
            disabled={!editable}
            onChange={(_, d) => write({ ...table, obligations: { ...o, auditDecisions: d.checked === true ? "all" : "non_allow" } })}
          />
          <Checkbox className={roClass} label={t("governance.policyTable.obDailyReport")} checked={o.dailyReport} disabled={!editable} onChange={(_, d) => write({ ...table, obligations: { ...o, dailyReport: d.checked === true } })} />
          <Checkbox
            className={roClass}
            label={t("governance.policyTable.obIsolation")}
            checked={o.isolation === "required"}
            disabled={!editable}
            onChange={(_, d) => write({ ...table, obligations: { ...o, isolation: d.checked === true ? "required" : "optional" } })}
          />
        </div>
      </div>
      {table.kept.length > 0 && (
        <div className={s.dividerSection}>
          <Text weight="semibold">{t("governance.policyTable.keptTitle")}</Text>
          <Text size={200} className={s.note}>
            {t("governance.policyTable.keptDesc")}
          </Text>
          <div className={parts.inset}>
            <ul className={parts.list} aria-label={t("governance.policyTable.keptTitle")}>
              {table.kept.map((r) => (
                <li key={r.id}>
                  <Text size={200}>
                    <span className={s.id}>{r.id}</span> · {r.action}
                    {r.principalType ? t("governance.policyTable.keptFor", { who: r.principalType === "human" ? t("governance.parts.principal.you") : t("governance.policy.principalPlural", { type: r.principalType }) }) : ""}
                    {r.environment ? t("governance.policyTable.keptIn", { env: r.environment }) : ""}
                    {r.resource ? t("governance.policyTable.keptOn", { resource: r.resource }) : ""} · <Word value={r.effect} />
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
