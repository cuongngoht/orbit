// THE VIRTUAL OFFICE'S REQUESTS, as the API holds every body to them: what is accepted (and as what), and what is
// refused with which words -- the office, its departments and employees, missions and their reviews, schedules, and the
// headers a change carries.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { DEFAULT_PRESETS, type ResourceProfile } from "./resources.js";
import type { Checked } from "./validate.js";
import {
  ASSIGNMENT_STATE_TEXT,
  ASSIGNMENT_STATES,
  checkAccept,
  checkAnswer,
  checkArchiveDepartment,
  checkCreateDepartment,
  checkCreateMission,
  checkCreateSchedule,
  checkEmployeeProfile,
  checkEmployment,
  checkExecutionProfile,
  checkHireAssistant,
  checkHireEmployee,
  checkMoveEmployee,
  checkReason,
  checkRequestRevision,
  checkResolveDelivery,
  checkScheduleRule,
  checkSetUpOffice,
  checkUpdateDepartment,
  checkUpdateEmployee,
  checkUpdateResources,
  checkUpdateSchedule,
  HOLDING_STATES,
  isDeliverableName,
  isHolding,
  isIdempotencyKey,
  isIntegrationEventType,
  isTerminal,
  isTimeZone,
  isWorkforceId,
  TERMINAL_STATES,
  versionOf,
  WORK_LABEL_TEXT,
  WORK_LABELS,
  type EmployeeProfile,
  type ExecutionProfile,
} from "./workforce.js";

const errorsOf = <T>(c: Checked<T>): string[] => (c.ok ? [] : c.errors);
const has = (errors: readonly string[], needle: string): void => assert.ok(errors.some((e) => e.includes(needle)), `"${needle}" in ${JSON.stringify(errors)}`);
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const EXECUTION: ExecutionProfile = { runtime: "claude", connectionId: null, model: "sonnet", effort: "high", webSearch: false, orbitPlugin: false };
const PROFILE: EmployeeProfile = { title: "Analyst", duties: "Reads the numbers.", instructions: "", skills: ["SQL"], languages: ["en"], knowledge: [], execution: EXECUTION, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false };
const RESOURCES = (DEFAULT_PRESETS[0] as { profile: ResourceProfile }).profile;

test("ids are lower-case UUIDs, and a deliverable is a plain file name", () => {
  const lettered = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assert.deepEqual([isWorkforceId(id(1)), isWorkforceId(lettered)], [true, true]);
  for (const bad of [lettered.toUpperCase(), "1", "", null, `${id(1)} `]) assert.equal(isWorkforceId(bad), false, String(bad));
  for (const ok of ["report.md", "Q3 summary (final).xlsx", "a"]) assert.equal(isDeliverableName(ok), true, ok);
  for (const bad of ["../x", "a..b", ".hidden", "-x", "a/b", "a\\b", "x".repeat(121), "", 7]) assert.equal(isDeliverableName(bad), false, String(bad));
});

test("an execution profile: the runtime, its model and effort as the CLI names them; its switches are true or false", () => {
  assert.deepEqual(checkExecutionProfile({ runtime: "claude", model: "claude-opus-4-1[1m]" }), { ok: true, value: { runtime: "claude", connectionId: null, model: "claude-opus-4-1[1m]", effort: null, webSearch: false, orbitPlugin: false } });
  assert.deepEqual(checkExecutionProfile({ ...EXECUTION, connectionId: id(7), webSearch: true, orbitPlugin: true }), { ok: true, value: { ...EXECUTION, connectionId: id(7), webSearch: true, orbitPlugin: true } });
  assert.deepEqual(errorsOf(checkExecutionProfile({ runtime: "gemini", connectionId: "c-1", model: "--dangerously-skip-permissions", effort: "Max", webSearch: "yes", orbitPlugin: 1, mode: "auto" })), [
    "mode is not a field of this request",
    "execution.runtime must be one of claude, codex, agy",
    "execution.connectionId must be an id",
    "execution.model must be a model the runtime names",
    "execution.effort must be an effort level the runtime names, or null",
    "execution.webSearch must be true or false",
    "execution.orbitPlugin must be true or false",
  ]);
  assert.deepEqual(checkExecutionProfile(null), { ok: false, errors: ["execution must be an object"] });
});

test("an employee's profile: its title, texts and lists within bounds, its execution, its delegation and assistants", () => {
  assert.deepEqual(checkEmployeeProfile(PROFILE), { ok: true, value: PROFILE });
  assert.deepEqual(checkEmployeeProfile({ title: "  Data   analyst ", execution: { runtime: "codex", model: "gpt-5" }, knowledge: [id(1), id(1)] }), {
    ok: true,
    value: { title: "Data analyst", duties: "", instructions: "", skills: [], languages: [], knowledge: [id(1)], execution: { runtime: "codex", connectionId: null, model: "gpt-5", effort: null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
  });
  const e = errorsOf(checkEmployeeProfile({ ...PROFILE, title: "", duties: "x".repeat(8001), skills: Array<string>(21).fill("s"), languages: ["x".repeat(41)], knowledge: ["ws-1"], execution: { runtime: "claude" }, canDelegate: "yes", canHirePermanent: 1, maxAssistants: 6, salary: 1 }));
  for (const needle of ["profile.salary is not a field of this request", "profile.title must be 1-120 printable characters", "profile.duties is too long", "profile.skills must be a short list of short lines", "profile.languages must be a short list of short lines", "profile.knowledge must be a short list of research workspace ids", "profile.execution.model must be a model the runtime names", "profile.canDelegate must be true or false", "profile.canHirePermanent must be true or false", "profile.maxAssistants must be 0-5"]) has(e, needle);
  assert.deepEqual(checkEmployeeProfile([]), { ok: false, errors: ["profile must be an object"] });
});

test("the office and its departments: names on one line; a member moves to a department or to Unassigned", () => {
  assert.deepEqual(checkSetUpOffice(undefined), { ok: true, value: { name: null, departments: [] } }, "no name typed: the account's company name is the company's");
  assert.deepEqual(checkSetUpOffice({ name: " Head  office " }), { ok: true, value: { name: "Head office", departments: [] } });
  // An older client's example departments are read as what they are -- the activation refuses them, never makes them.
  assert.deepEqual(checkSetUpOffice({ name: "Acme", departments: ["Sales", "Sales", "Research"] }), { ok: true, value: { name: "Acme", departments: ["Sales", "Research"] } });
  assert.deepEqual(errorsOf(checkSetUpOffice({ departments: Array<string>(13).fill("D") })), ["departments must be a list of names"]);
  assert.deepEqual(errorsOf(checkSetUpOffice({ name: "" })), ["name must be 1-80 printable characters"]);
  assert.deepEqual(checkSetUpOffice("office"), { ok: false, errors: ["the body must be a JSON object"] });
  assert.deepEqual(checkCreateDepartment({ name: "  Finance " }), { ok: true, value: { name: "Finance" } });
  assert.deepEqual(errorsOf(checkCreateDepartment({ name: "a\u0007b" })), ["name must be 1-80 printable characters"]);
  assert.deepEqual(checkUpdateDepartment({ position: 0 }), { ok: true, value: { position: 0 } });
  assert.deepEqual(errorsOf(checkUpdateDepartment({})), ["nothing to change: send name, position or defaults"]);
  assert.deepEqual(errorsOf(checkUpdateDepartment({ position: 1000 })), ["position must be 0-999"]);
  assert.deepEqual(checkArchiveDepartment(undefined), { ok: true, value: {} });
  assert.deepEqual(checkArchiveDepartment({ moveTo: null }), { ok: true, value: { moveTo: null } });
  assert.deepEqual(checkArchiveDepartment({ moveTo: id(2) }), { ok: true, value: { moveTo: id(2) } });
  assert.deepEqual(errorsOf(checkArchiveDepartment({ moveTo: "sales" })), ["moveTo must be a department id, or null for Unassigned"]);
  assert.deepEqual(checkMoveEmployee({ departmentId: null }), { ok: true, value: { departmentId: null } });
  assert.deepEqual(errorsOf(checkMoveEmployee({})), ["departmentId must be a department id, or null for Unassigned"]);
});

test("a hire: a name, a profile and the sandbox's resources; skipping the trial says why", () => {
  assert.deepEqual(checkHireEmployee({ name: " Ada ", profile: PROFILE, resources: RESOURCES }), { ok: true, value: { name: "Ada", departmentId: null, managerId: null, templateId: null, profile: PROFILE, resources: RESOURCES, skipProbation: false, skipReason: "" } });
  assert.deepEqual(errorsOf(checkHireEmployee({ name: "Ada", profile: PROFILE, resources: RESOURCES, skipProbation: true })), ["skipReason says why the trial is skipped: it is recorded with the decision"]);
  assert.equal(checkHireEmployee({ name: "Ada", departmentId: id(2), managerId: id(3), templateId: "analyst", profile: PROFILE, resources: RESOURCES, skipProbation: true, skipReason: "a contractor we know" }).ok, true);
  const e = errorsOf(checkHireEmployee({ name: "", departmentId: "sales", managerId: 3, templateId: "", profile: { ...PROFILE, title: "" }, resources: { ...RESOURCES, cpuMillis: 10 }, skipProbation: "no" }));
  for (const needle of ["resources.cpuMillis must be a whole number", "name must be 1-80 printable characters", "departmentId must be an id or null", "managerId must be an id or null", "templateId must be a template's id", "profile.title must be 1-120", "skipProbation must be true or false"]) has(e, needle);
  assert.deepEqual(errorsOf(checkHireEmployee({ name: "Ada", profile: PROFILE })), ["resources must be an object"]);
});

test("a change of an employee names what changes, and a restore the revision it copies; resources, employment and assistants likewise", () => {
  assert.deepEqual(checkUpdateEmployee({ managerId: null, note: " promoted " }), { ok: true, value: { managerId: null, note: "promoted" } });
  assert.deepEqual(checkUpdateEmployee({ profile: PROFILE, basedOn: 2 }), { ok: true, value: { profile: PROFILE, note: "", basedOn: 2 } });
  assert.deepEqual(errorsOf(checkUpdateEmployee({ note: "only a note" })), ["nothing to change: send name, managerId or profile"]);
  assert.deepEqual(errorsOf(checkUpdateEmployee({ name: "Ada", basedOn: 0 })), ["basedOn must be a profile revision"]);
  assert.deepEqual(checkUpdateResources({ resources: RESOURCES }), { ok: true, value: { resources: RESOURCES, note: "" } });
  assert.deepEqual(errorsOf(checkUpdateResources({ resources: { ...RESOURCES, pidsLimit: 1 }, note: "x".repeat(2001) })), ["resources.pidsLimit must be a whole number from 64 to 32768", "note is too long"]);
  assert.deepEqual(checkEmployment({ command: "suspend", reason: " audit ", held: "keep_paused" }), { ok: true, value: { command: "suspend", reason: "audit", held: "keep_paused" } });
  assert.deepEqual(checkEmployment({ command: "activate" }), { ok: true, value: { command: "activate", reason: "" } });
  assert.deepEqual(errorsOf(checkEmployment({ command: "fire", held: "drop" })), ["command must be one of start_probation, activate, reject, suspend, reinstate, archive, delete", "held must be keep_paused or cancel"]);
  assert.deepEqual(checkHireAssistant({ name: "Helper", ttlMinutes: 60, missionId: id(3), profile: PROFILE }), { ok: true, value: { name: "Helper", ttlMinutes: 60, missionId: id(3), profile: PROFILE } });
  assert.deepEqual(errorsOf(checkHireAssistant({ name: "Helper", ttlMinutes: 7 * 24 * 60 + 1, missionId: "m", profile: PROFILE })), ["ttlMinutes must be 1 minute to 7 days", "missionId must be a mission id"]);
});

test("a mission: its goal and brief, a title from the goal's first line when none is given, and every default said", () => {
  assert.deepEqual(checkCreateMission({ goal: "Summarise Q3 sales\nwith sources", targetEmployeeId: id(4), deliverables: [{ name: "summary.md" }, { name: "data.csv", required: false }], acceptanceCriteria: [" cites every figure "], deadline: "2026-12-01T09:00:00+07:00" }), {
    ok: true,
    value: { goal: "Summarise Q3 sales\nwith sources", title: "Summarise Q3 sales", target: { kind: "employee", employeeId: id(4) }, targetEmployeeId: id(4), whenBusy: "reject", workspaceId: null, sourceRevisionIds: [], repositories: [], deliverables: [{ name: "summary.md", required: true }, { name: "data.csv", required: false }], acceptanceCriteria: ["cites every figure"], acceptanceMode: "owner_review", deadline: "2026-12-01T02:00:00.000Z", priority: 5 },
  });
  const full = checkCreateMission({ goal: "x", title: "X", targetEmployeeId: id(4), whenBusy: "enqueue", workspaceId: id(5), sourceRevisionIds: [id(6), id(6)], deliverables: [], acceptanceCriteria: [], acceptanceMode: "manager_review", deadline: null, priority: 9, execution: { model: "opus", effort: null } });
  assert.deepEqual(full.ok && [full.value.whenBusy, full.value.sourceRevisionIds, full.value.execution, full.value.priority, full.value.deadline], ["enqueue", [id(6)], { model: "opus", effort: null }, 9, null]);
  const e = errorsOf(checkCreateMission({ goal: "", title: "", targetEmployeeId: "ada", whenBusy: "wait", workspaceId: "ws", deliverables: [{ name: "a.md" }, { name: "A.md" }, { name: "../etc" }], acceptanceCriteria: "all", acceptanceMode: "auto", deadline: "soon", priority: 10, execution: { model: "opus", connectionId: id(1) }, budget: 1 }));
  for (const needle of ["budget is not a field of this request", "goal must be 1-8000 characters", "title must be 1-120 printable characters", "targetEmployeeId must be an employee's id", "whenBusy must be one of reject, enqueue", "workspaceId must be a research workspace id or null", "acceptanceCriteria must be a short list of short lines", "acceptanceMode must be one of owner_review, manager_review", "deadline must be an ISO time or null", "priority must be 0-9", "execution may override model and effort only", "each deliverable is { name: a plain file name, required: true or false }", "two deliverables share a name"]) has(e, needle);
  assert.deepEqual(errorsOf(checkCreateMission({ goal: "g", targetEmployeeId: id(4), sourceRevisionIds: [id(6)] })), ["sourceRevisionIds needs the workspaceId they belong to"]);
  has(errorsOf(checkCreateMission({ goal: "g", targetEmployeeId: id(4), workspaceId: id(5), sourceRevisionIds: Array.from({ length: 41 }, (_, i) => id(100 + i)) })), "sourceRevisionIds must be at most 40 revision ids");
  assert.deepEqual(checkCreateMission("do it"), { ok: false, errors: ["the body must be a JSON object"] });
});

test("a mission names whom it goes to: an employee, a department or the CEO -- with what the person saw, and never two names", () => {
  const dept = checkCreateMission({ goal: "g", target: { kind: "department", departmentId: id(7) }, expectedAssignee: { employeeId: id(4), appointmentId: id(8), appointmentRevision: 2 } });
  assert.deepEqual(dept.ok && [dept.value.target, dept.value.targetEmployeeId, dept.value.expectedAssignee], [{ kind: "department", departmentId: id(7) }, "", { employeeId: id(4), appointmentId: id(8), appointmentRevision: 2 }]);
  const ceo = checkCreateMission({ goal: "g", target: { kind: "ceo" } });
  assert.deepEqual(ceo.ok && ceo.value.target, { kind: "ceo" });
  assert.deepEqual(errorsOf(checkCreateMission({ goal: "g" })), ["target must name who the mission is given to: an employee, a department or the CEO"]);
  has(errorsOf(checkCreateMission({ goal: "g", target: { kind: "team" } })), "target.kind must be one of employee, department, ceo");
  has(errorsOf(checkCreateMission({ goal: "g", target: { kind: "ceo", departmentId: id(7) } })), "target of kind ceo names only kind");
  has(errorsOf(checkCreateMission({ goal: "g", target: { kind: "department", departmentId: "research" } })), "target.departmentId must be a department's id");
  has(errorsOf(checkCreateMission({ goal: "g", target: { kind: "employee", employeeId: id(4) }, targetEmployeeId: id(5) })), "target_conflict");
  has(errorsOf(checkCreateMission({ goal: "g", target: { kind: "ceo" }, expectedAssignee: { employeeId: id(4) } })), "expectedAssignee must be");
});

test("a review names the digest of the handoff that was read; a cancel or a pause may say why; an answer says something", () => {
  const digest = "b".repeat(64);
  assert.deepEqual(checkRequestRevision({ handoffDigest: digest, criteria: " Add the sources\r\n please " }), { ok: true, value: { handoffDigest: digest, criteria: "Add the sources\n please" } });
  assert.deepEqual(errorsOf(checkRequestRevision({ handoffDigest: "abc", criteria: "" })), ["handoffDigest must be the digest of the handoff being reviewed", "criteria says what must change"]);
  assert.deepEqual(checkAccept({ handoffDigest: digest }), { ok: true, value: { handoffDigest: digest, note: "" } });
  assert.deepEqual(errorsOf(checkAccept({ handoffDigest: digest.toUpperCase(), note: "x".repeat(2001) })), ["handoffDigest must be the digest of the handoff being accepted", "note is too long"]);
  assert.deepEqual(checkReason(undefined), { ok: true, value: { reason: "" } });
  assert.deepEqual(checkReason({ reason: " no longer needed " }), { ok: true, value: { reason: "no longer needed" } });
  assert.deepEqual(errorsOf(checkReason({ why: "x" })), ["why is not a field of this request"]);
  assert.deepEqual(checkAnswer({ answer: " 42 " }), { ok: true, value: { answer: "42" } });
  assert.deepEqual(errorsOf(checkAnswer({ answer: "   " })), ["answer must say something"]);
  assert.deepEqual(checkResolveDelivery({ outcome: "resend", reason: "the mailbox bounced" }), { ok: true, value: { outcome: "resend", reason: "the mailbox bounced" } });
  assert.deepEqual(errorsOf(checkResolveDelivery({ outcome: "lost", reason: "" })), ["outcome must be delivered or resend", "reason says how this is known: it is recorded"]);
});

test("a schedule's rule: a kind, an IANA time zone -- never a UTC offset -- a local time, and the day its kind needs", () => {
  assert.deepEqual(checkScheduleRule({ kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00" }), { ok: true, value: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", dayOfMonth: 1, period: "previous" } });
  assert.deepEqual(checkScheduleRule({ kind: "weekly", timezone: "Europe/Berlin", localTime: "23:59", dayOfWeek: 7, period: "current", dayOfMonth: 3 }), { ok: true, value: { kind: "weekly", timezone: "Europe/Berlin", localTime: "23:59", dayOfWeek: 7, period: "current" } });
  assert.deepEqual(checkScheduleRule({ kind: "daily", timezone: "UTC", localTime: "00:00", dayOfWeek: 9 }), { ok: true, value: { kind: "daily", timezone: "UTC", localTime: "00:00", period: "previous" } });
  for (const timezone of ["Asia/Ho_Chi_Minh", "America/New_York", "Australia/Lord_Howe", "America/Port-au-Prince", "America/Argentina/Buenos_Aires", "UTC", "Etc/GMT-14", "Etc/GMT+7"]) {
    assert.equal(isTimeZone(timezone), true, timezone);
    assert.equal(checkScheduleRule({ kind: "daily", timezone, localTime: "09:30" }).ok, true, timezone);
  }
  // An offset is no zone (no daylight-saving rule), and PostgreSQL reads "+07:00" as seven hours WEST of Greenwich.
  for (const timezone of ["+07:00", "-05:00", "+0530", "Mars/Olympus", "", "Asia/Ho Chi Minh", " UTC", "x".repeat(65), 7, null]) {
    assert.equal(isTimeZone(timezone), false, String(timezone));
    assert.deepEqual(errorsOf(checkScheduleRule({ kind: "daily", timezone, localTime: "09:30" })), ["rule.timezone must be an IANA time zone (Asia/Ho_Chi_Minh)"], String(timezone));
  }
  assert.deepEqual(errorsOf(checkScheduleRule({ kind: "hourly", timezone: "UTC", localTime: "24:00", period: "next", at: "x" })), ["rule.at is not a field of this request", "rule.kind must be one of daily, weekly, monthly, quarterly", "rule.localTime must be HH:MM", "rule.period must be previous or current"]);
  assert.deepEqual(errorsOf(checkScheduleRule({ kind: "daily", timezone: "UTC", localTime: "7:30" })), ["rule.localTime must be HH:MM"]);
  assert.deepEqual(errorsOf(checkScheduleRule({ kind: "weekly", timezone: "UTC", localTime: "08:00" })), ["rule.dayOfWeek must be 1 (Monday) to 7"]);
  assert.deepEqual(errorsOf(checkScheduleRule({ kind: "monthly", timezone: "UTC", localTime: "08:00", dayOfMonth: 29 })), ["rule.dayOfMonth must be 1-28"]);
  assert.deepEqual(checkScheduleRule("daily"), { ok: false, errors: ["rule must be an object"] });
});

const SCHEDULE = { name: "Quarterly revenue", rule: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00" }, employeeId: id(4), mission: { goal: "Report the quarter's revenue", deliverables: [{ name: "revenue.xlsx" }], acceptanceCriteria: ["Totals match"] }, recipients: [{ address: " CFO@Example.com ", channel: "external" }] };

test("a schedule: its rule, its employee, the mission each period makes, who receives the result -- and every default said", () => {
  assert.deepEqual(checkCreateSchedule(SCHEDULE), {
    ok: true,
    value: {
      name: "Quarterly revenue",
      rule: { kind: "quarterly", timezone: "Asia/Ho_Chi_Minh", localTime: "08:00", dayOfMonth: 1, period: "previous" },
      employeeId: id(4),
      mission: { goal: "Report the quarter's revenue", deliverables: [{ name: "revenue.xlsx", required: true }], acceptanceCriteria: ["Totals match"], workspaceId: null, sourceRevisionIds: [] },
      recipients: [{ address: "cfo@example.com", channel: "external" }],
      missedPolicy: "catch_up_each",
      catchUpLimit: 4,
    },
  });
  // A period's mission names its sources with the research workspace they belong to, as any mission does.
  assert.deepEqual(errorsOf(checkCreateSchedule({ ...SCHEDULE, mission: { goal: "g", sourceRevisionIds: [id(6)] } })), ["mission.sourceRevisionIds needs the workspaceId they belong to"]);
  const sourced = checkCreateSchedule({ ...SCHEDULE, mission: { goal: "g", workspaceId: id(5), sourceRevisionIds: [id(6), id(6)] } });
  assert.deepEqual(sourced.ok && [sourced.value.mission.workspaceId, sourced.value.mission.sourceRevisionIds], [id(5), [id(6)]]);
  const e = errorsOf(checkCreateSchedule({ name: "", rule: { kind: "daily", timezone: "+07:00", localTime: "8:00" }, employeeId: "ada", mission: {}, recipients: [{ address: "nobody", channel: "fax" }], missedPolicy: "ignore", catchUpLimit: 9 }));
  for (const needle of ["each recipient is { address: an email, channel: inbox | external }", "name must be 1-80 printable characters", "rule.timezone must be an IANA time zone", "rule.localTime must be HH:MM", "employeeId must be an employee's id", "mission.goal says what each period's work is", "missedPolicy must be one of catch_up_latest, catch_up_each, skip", "catchUpLimit must be 1-8"]) has(e, needle);
  assert.deepEqual(errorsOf(checkCreateSchedule({ ...SCHEDULE, recipients: Array.from({ length: 11 }, (_, i) => ({ address: `p${i}@example.com`, channel: "inbox" })) })), ["recipients must be a list of at most 10 { address, channel }"]);
  assert.deepEqual(checkUpdateSchedule({ state: "paused", catchUpLimit: 1 }), { ok: true, value: { catchUpLimit: 1, state: "paused" } });
  assert.deepEqual(errorsOf(checkUpdateSchedule({})), ["nothing to change"]);
  assert.deepEqual(errorsOf(checkUpdateSchedule({ state: "stopped", rule: { kind: "daily", timezone: "+07:00", localTime: "08:00" } })), ["rule.timezone must be an IANA time zone (Asia/Ho_Chi_Minh)", "state must be active or paused"]);
});

test("If-Match names a version; an idempotency key is a token of 8 to 128 safe characters", () => {
  assert.deepEqual([versionOf('"7"'), versionOf("7"), versionOf('W/"12"'), versionOf([' "3" ', '"4"']), versionOf(" 7 ")], [7, 7, 12, 3, 7]);
  for (const bad of [undefined, "", "*", '"v7"', '"-1"', '"1.5"', '"9999999999999"', 7, null, []]) assert.equal(versionOf(bad), null, JSON.stringify(bad));
  for (const ok of [randomUUID(), "order:2026-11-21.1", "x".repeat(128)]) assert.equal(isIdempotencyKey(ok), true, ok);
  for (const bad of ["short", "has a space here", "x".repeat(129), "semi;colon-12", 12345678, null]) assert.equal(isIdempotencyKey(bad), false, String(bad));
});

test("an assignment holds its employee in every state but the queue and the ends, and every state and work label is said in words", () => {
  assert.deepEqual([...TERMINAL_STATES], ["COMPLETED", "CANCELLED", "FAILED_FINAL"]);
  assert.deepEqual(HOLDING_STATES, ASSIGNMENT_STATES.filter((s) => s !== "QUEUED" && !TERMINAL_STATES.includes(s)));
  assert.deepEqual([isHolding("QUEUED"), isHolding("RUNNING"), isHolding("COMPLETED"), isTerminal("CANCELLED"), isTerminal("PAUSED")], [false, true, false, true, false]);
  assert.deepEqual(Object.keys(ASSIGNMENT_STATE_TEXT), [...ASSIGNMENT_STATES]);
  assert.deepEqual(Object.keys(WORK_LABEL_TEXT), [...WORK_LABELS]);
  assert.deepEqual([isIntegrationEventType("SandboxReady"), isIntegrationEventType("Nope"), isIntegrationEventType("toString")], [true, false, false]);
});

test("a mission's repositories: each one the employee may use, named as the connector lists it, at its branch or the default one", () => {
  const ok = checkCreateMission({ goal: "g", targetEmployeeId: id(4), repositories: [{ source: "azure", id: "Fabrikam/278d5cd2-584d-4b63-824a-2ba458937249", branch: "develop" }, { source: "github", id: "octo/app" }] });
  assert.deepEqual(ok.ok && ok.value.repositories, [
    { source: "azure", id: "Fabrikam/278d5cd2-584d-4b63-824a-2ba458937249", branch: "develop" },
    { source: "github", id: "octo/app", branch: null },
  ]);
  for (const repositories of ["octo/app", [{ source: "gitlab", id: "a/b" }], [{ source: "github", id: "" }], [{ source: "github", id: "a/b", branch: "-x" }], [{ source: "github", id: "a/b", branch: "a..b" }], [{ source: "github", id: "a/b", token: "t" }], [{ source: "github", id: "a/b" }, { source: "github", id: "a/b" }], Array.from({ length: 6 }, (_, i) => ({ source: "github", id: `o/r${i}` }))])
    has(errorsOf(checkCreateMission({ goal: "g", targetEmployeeId: id(4), repositories })), "repositories must be");
});
