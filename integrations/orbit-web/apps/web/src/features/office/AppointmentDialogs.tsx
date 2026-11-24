// THE COMPANY'S AUTHORITY, changed by a person: its CEO and each department's manager -- appointed to an empty slot,
// replaced, suspended, reinstated or revoked, each against the version of the appointment the page read (If-Match).
// Authority is the appointment alone: a title or the team-lead switch grants none. Whom to appoint is chosen among the
// employees on trial or active -- a manager among its own department's members -- and the API holds every rule again:
// what it refuses is said as it said it.
import { Badge, Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Link, Menu, MenuDivider, MenuItem, MenuList, MenuPopover, MenuTrigger, Select, Spinner, Text } from "@fluentui/react-components";
import { MoreHorizontal16Regular } from "@fluentui/react-icons";
import type { AppointmentState, AppointmentSummary, Department, Employment, Roster } from "@orbit-web/contracts";
import { useState, type ReactNode } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n, type I18nContextValue, type MessageKey } from "../../i18n";
import { office, wholeRoster, type AppointmentChange } from "./api";
import { ProblemBar, problemOf, useOfficeStyles, type Problem } from "./parts";

// A slot of the company's authority and whoever holds it now (null: nobody -- a company works without a CEO, a
// department without a manager).
export type AppointmentSlot = { role: "ceo"; incumbent: AppointmentSummary | null } | { role: "manager"; department: Department; incumbent: AppointmentSummary | null };

export type AppointmentAct = "appoint" | "replace" | AppointmentChange;

// What a person asked to do: an empty slot is appointed to; an incumbent is replaced, suspended, reinstated or revoked.
export type AppointmentEdit = { act: "appoint"; slot: AppointmentSlot } | { act: Exclude<AppointmentAct, "appoint">; slot: AppointmentSlot; incumbent: AppointmentSummary };

// What may be done with a slot, from the state of whoever holds it ("empty": nobody does).
const ACTS: Record<"empty" | AppointmentState, AppointmentAct[]> = {
  empty: ["appoint"],
  active: ["replace", "suspend", "revoke"],
  suspended: ["replace", "reinstate", "revoke"],
  revoked: ["appoint"],
  replaced: ["appoint"],
};

const ACT_KEYS: Record<AppointmentAct, MessageKey> = {
  appoint: "office.appointment.act.appoint",
  replace: "office.appointment.act.replace",
  suspend: "office.appointment.act.suspend",
  reinstate: "office.appointment.act.reinstate",
  revoke: "office.appointment.act.revoke",
};

const TITLE_KEYS: Record<AppointmentAct, MessageKey> = {
  appoint: "office.appointment.title.appoint",
  replace: "office.appointment.title.replace",
  suspend: "office.appointment.title.suspend",
  reinstate: "office.appointment.title.reinstate",
  revoke: "office.appointment.title.revoke",
};

const MEANS_KEYS: Record<AppointmentAct, MessageKey> = {
  appoint: "office.appointment.means.appoint",
  replace: "office.appointment.means.replace",
  suspend: "office.appointment.means.suspend",
  reinstate: "office.appointment.means.reinstate",
  revoke: "office.appointment.means.revoke",
};

export const APPOINTMENT_STATE_KEYS: Record<AppointmentState, MessageKey> = {
  active: "office.appointment.state.active",
  suspended: "office.appointment.state.suspended",
  revoked: "office.appointment.state.revoked",
  replaced: "office.appointment.state.replaced",
};

const STATE_TONE: Record<AppointmentState, "success" | "warning" | "subtle" | "informative"> = { active: "success", suspended: "warning", revoked: "subtle", replaced: "informative" };

// Who may be appointed (the API's rule, said again here only to offer the right people): on trial or active.
const WORKING: readonly Employment[] = ["probation", "active"];

// An appointment's state, as words (a colour never says it alone).
export function AppointmentStateBadge({ state }: { state: AppointmentState }) {
  const { t } = useI18n();
  return (
    <Badge appearance="tint" color={STATE_TONE[state]} style={{ borderRadius: "9999px", whiteSpace: "nowrap", flexShrink: 0 }}>
      {t(APPOINTMENT_STATE_KEYS[state])}
    </Badge>
  );
}

// Whoever holds a slot, as a chip: "Manager: Minh" -- the name opens the employee -- and how the appointment stands
// (always, or only when it is not simply active).
export function AppointmentHolder({ who, prefix = "", stateAlways = false, onOpen }: { who: AppointmentSummary; prefix?: string; stateAlways?: boolean; onOpen: (employeeId: string) => void }) {
  const o = useOfficeStyles();
  return (
    <span className={o.row} style={{ gap: "6px" }}>
      <Text size={200} className={o.wrap}>
        {prefix}
        <Link as="button" inline onClick={() => onOpen(who.employeeId)}>
          {who.name}
        </Link>
      </Text>
      {(stateAlways || who.state !== "active") && <AppointmentStateBadge state={who.state} />}
    </span>
  );
}

// A slot in words: "CEO", "manager of Accounting".
const slotText = (t: I18nContextValue["t"], slot: AppointmentSlot): string => (slot.role === "ceo" ? t("office.appointment.slot.ceo") : t("office.appointment.slot.manager", { department: slot.department.name }));

// The menu of one slot: what may be done with it now, and whatever its row adds after a divider.
export function AppointmentMenu({ slot, label, onPick, children }: { slot: AppointmentSlot; label: string; onPick: (edit: AppointmentEdit) => void; children?: ReactNode }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const incumbent = slot.incumbent;
  const pick = (act: AppointmentAct) => onPick(act === "appoint" || incumbent === null ? { act: "appoint", slot } : { act, slot, incumbent });
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button className={o.touch} appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} aria-label={label} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {ACTS[incumbent?.state ?? "empty"].map((act) => (
            <MenuItem key={act} onClick={() => pick(act)}>
              {t(ACT_KEYS[act])}
            </MenuItem>
          ))}
          {children !== undefined && <MenuDivider />}
          {children}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

// Whom a slot may be given to: an employee on trial or active, of the department for its manager, never the incumbent.
// One who holds another appointment is shown but cannot be chosen (the API refuses it: end that one first).
function Candidates({ roster, slot, value, onChange }: { roster: Roster; slot: AppointmentSlot; value: string; onChange: (employeeId: string) => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const department = slot.role === "manager" ? slot.department : null;
  const people = roster.employees.filter((e) => WORKING.includes(e.employment) && (department === null || e.departmentId === department.id) && e.id !== slot.incumbent?.employeeId);
  if (people.length === 0)
    return (
      <Text size={200} className={o.muted}>
        {department === null ? t("office.appointment.noCandidate") : t("office.appointment.noMember", { department: department.name })}
      </Text>
    );
  return (
    <Field label={t("office.appointment.whoLabel")} required hint={department === null ? t("office.appointment.whoHintCeo") : t("office.appointment.whoHintManager", { department: department.name })}>
      <Select value={value} onChange={(_, d) => onChange(d.value)}>
        <option value="">{t("office.appointment.whoPlaceholder")}</option>
        {people.map((e) => (
          <option key={e.id} value={e.id} disabled={e.role !== null}>
            {e.role !== null ? t("office.appointment.holdsOne", { name: e.name }) : t("office.appointment.option", { name: e.name, title: e.title })}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function AppointmentDialog({ edit, onClose, onDone }: { edit: AppointmentEdit; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const slot = edit.slot;
  const department = slot.role === "manager" ? slot.department : null;
  const choosing = edit.act === "appoint" || edit.act === "replace";
  // Everybody who could be chosen, unfiltered and every page (a manager's among its department's members).
  const people = useResource<Roster>(choosing ? () => wholeRoster(department?.id ?? null) : null, [choosing, department?.id]);
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const words = { slot: slotText(t, slot), name: edit.act === "appoint" ? "" : edit.incumbent.name, department: department?.name ?? "" };
  const request = (): Promise<unknown> => {
    const why = reason.trim() === "" ? {} : { reason: reason.trim() };
    if (edit.act === "appoint") return office.appoint({ role: slot.role, ...(department !== null ? { departmentId: department.id } : {}), employeeId, ...why });
    if (edit.act === "replace") return office.replaceAppointment(edit.incumbent.appointmentId, edit.incumbent.version, { employeeId, ...why });
    return office.changeAppointment(edit.incumbent.appointmentId, edit.incumbent.version, edit.act, why);
  };
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await request();
      onDone();
    } catch (err) {
      setProblem(problemOf(err, t("office.appointment.stale")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{t(TITLE_KEYS[edit.act], words)}</DialogTitle>
            <DialogContent className={o.form}>
              {edit.act !== "appoint" && (
                <div className={o.row}>
                  <Text className={o.wrap}>{t("office.appointment.holder", words)}</Text>
                  <AppointmentStateBadge state={edit.incumbent.state} />
                </div>
              )}
              <Text size={200} className={o.muted}>
                {t(MEANS_KEYS[edit.act], words)}
                {edit.act === "appoint" && department !== null ? ` ${t("office.appointment.means.appointManager", words)}` : ""}
              </Text>
              {choosing &&
                (people.data === null ? (
                  people.error !== null ? (
                    <Text size={200} className={o.danger}>
                      {people.error}
                    </Text>
                  ) : (
                    <Spinner size="tiny" label={t("office.appointment.reading")} />
                  )
                ) : (
                  <Candidates roster={people.data} slot={slot} value={employeeId} onChange={setEmployeeId} />
                ))}
              <Field label={t("office.appointment.reasonLabel")} hint={t("office.appointment.reasonHint")}>
                <Input value={reason} maxLength={1000} onChange={(_, d) => setReason(d.value)} />
              </Field>
              <ProblemBar problem={problem} />
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{t("office.appointment.cancel")}</Button>
              <Button appearance="primary" type="submit" disabled={busy || (choosing && employeeId === "")}>
                {t(ACT_KEYS[edit.act])}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
