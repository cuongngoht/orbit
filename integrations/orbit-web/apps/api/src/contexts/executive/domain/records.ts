// THE COMPANY'S RECORDS, as CEO Chat says them (Executive, pure; ADR 0062). One snapshot of what Orbit's own read models
// hold -- the office, its departments and people, the open missions, what waits for the owner, the resources -- made
// into the reports a quick action shows (Orbit's words, never a model's) and the lines a CEO's answer is given to stand
// on. Nothing here reads a desk, a hand-in's files, a connector or a credential: names, states and counts only.
import type { ExecutiveReport, ExecutiveReportKind } from "@orbit-web/contracts";

export interface PersonRecord {
  name: string;
  // What the office shows of it now ("Ready", "Working", "Waiting for teammates" ...).
  state: string;
  // The mission it holds, if any.
  work: string | null;
}

export interface CompanyRecords {
  at: string;
  company: string;
  ceo: (PersonRecord & { appointment: "active" | "suspended" }) | null;
  departments: { name: string; manager: string | null; people: PersonRecord[] }[];
  // Working outside any department (the CEO excepted).
  unassigned: PersonRecord[];
  // The missions not ended, newest first.
  missions: { title: string; state: string; next: string | null; responsible: string | null; deadline: string | null; href: string }[];
  // What waits for the owner: decisions in Needs me, and approvals.
  needsYou: { title: string; detail: string; href: string }[];
  approvals: number;
  resources: { running: number; maxConcurrent: number; waiting: number; cpu: string; memory: string };
  // Whether work can be given to the CEO now (who is responsible for the CEO's slot), and why not: told to the CEO, so it
  // does not propose work that cannot start, and to the owner.
  assign: { ok: boolean; reason: string | null };
}

const assignLine = (a: CompanyRecords["assign"]): string => (a.ok ? "it can be given now (the CEO gives it to the departments through their managers)." : `it CANNOT be given now -- ${a.reason ?? "nobody can take it."}`);

const LINE = 220;
const cut = (s: string, n = LINE): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const personLine = (p: PersonRecord): string => `${p.name} (${p.state}${p.work !== null ? `: ${p.work}` : ""})`;

function status(r: CompanyRecords): ExecutiveReport {
  const people = r.departments.reduce((n, d) => n + d.people.length, 0) + r.unassigned.length + (r.ceo !== null ? 1 : 0);
  const working = [...r.departments.flatMap((d) => d.people), ...r.unassigned, ...(r.ceo !== null ? [r.ceo] : [])].filter((p) => p.work !== null).length;
  return {
    kind: "status",
    title: `${r.company} today`,
    at: r.at,
    facts: [
      { label: "CEO", value: r.ceo === null ? "none appointed" : `${r.ceo.name}${r.ceo.appointment === "suspended" ? " (suspended)" : ""} — ${r.ceo.state}` },
      { label: "Departments", value: `${r.departments.length} (${r.departments.filter((d) => d.manager !== null).length} with a manager)` },
      { label: "Employees", value: `${people}, ${working} working` },
      { label: "Open missions", value: String(r.missions.length) },
      { label: "Waiting for you", value: `${r.needsYou.length} in Needs me, ${r.approvals} approval(s)` },
      { label: "Running now", value: `${r.resources.running} of ${r.resources.maxConcurrent}` },
      { label: "Work for the CEO", value: r.assign.ok ? "can be given now" : `cannot be given now: ${r.assign.reason ?? ""}`.trim() },
    ],
    items: r.missions.slice(0, 5).map((m) => ({ title: m.title, detail: [m.state, m.responsible, m.next].filter((x) => x !== null).join(" · "), href: m.href, tone: null })),
  };
}

function missions(r: CompanyRecords): ExecutiveReport {
  return {
    kind: "missions",
    title: "Active missions",
    at: r.at,
    facts: [{ label: "Open", value: String(r.missions.length) }],
    items: r.missions.slice(0, 20).map((m) => ({ title: m.title, detail: [m.state, m.responsible !== null ? `with ${m.responsible}` : null, m.deadline !== null ? `due ${m.deadline.slice(0, 10)}` : null, m.next].filter((x) => x !== null).join(" · "), href: m.href, tone: /blocked|failed/i.test(m.state) ? "danger" : /review|waiting/i.test(m.state) ? "warning" : null })),
  };
}

function departments(r: CompanyRecords): ExecutiveReport {
  return {
    kind: "departments",
    title: "Departments",
    at: r.at,
    facts: [
      { label: "Departments", value: String(r.departments.length) },
      { label: "Without a manager", value: String(r.departments.filter((d) => d.manager === null).length) },
    ],
    items: r.departments.map((d) => {
      const busy = d.people.filter((p) => p.work !== null).length;
      return { title: d.name, detail: `${d.manager !== null ? `Manager: ${d.manager}` : "No manager"} · ${d.people.length} people, ${busy} working${d.people.length > 0 ? ` · ${d.people.map(personLine).join(", ")}` : ""}`.slice(0, 600), href: null, tone: d.manager === null ? "warning" : null };
    }),
  };
}

function resources(r: CompanyRecords): ExecutiveReport {
  const x = r.resources;
  return {
    kind: "resources",
    title: "Resource usage",
    at: r.at,
    facts: [
      { label: "Running", value: `${x.running} of ${x.maxConcurrent} at once` },
      { label: "Waiting to start", value: String(x.waiting) },
      { label: "CPU held", value: x.cpu },
      { label: "Memory held", value: x.memory },
    ],
    items: [],
  };
}

function decisions(r: CompanyRecords): ExecutiveReport {
  return {
    kind: "decisions",
    title: "Waiting for you",
    at: r.at,
    facts: [
      { label: "Needs me", value: String(r.needsYou.length) },
      { label: "Approvals", value: String(r.approvals) },
    ],
    items: r.needsYou.slice(0, 20).map((n) => ({ title: n.title, detail: n.detail, href: n.href, tone: "warning" })),
  };
}

const REPORTS: Record<ExecutiveReportKind, (r: CompanyRecords) => ExecutiveReport> = { status, missions, departments, resources, decisions };

export const reportOf = (kind: ExecutiveReportKind, r: CompanyRecords): ExecutiveReport => REPORTS[kind](r);

// What a CEO's answer is given to stand on: the records, one fact per line, bounded.
export function recordLines(r: CompanyRecords): string[] {
  const lines = [
    `Company: ${r.company} (records as of ${r.at})`,
    r.ceo === null ? "CEO: none appointed" : `CEO: ${personLine(r.ceo)}`,
    ...r.departments.map((d) => `Department ${d.name}: ${d.manager !== null ? `manager ${d.manager}` : "no manager"}; ${d.people.length} people${d.people.length > 0 ? `: ${d.people.map(personLine).join(", ")}` : ""}`),
    ...(r.unassigned.length > 0 ? [`In no department: ${r.unassigned.map(personLine).join(", ")}`] : []),
    `Open missions: ${r.missions.length}`,
    ...r.missions.slice(0, 15).map((m) => `- ${m.title}: ${[m.state, m.responsible !== null ? `with ${m.responsible}` : null, m.deadline !== null ? `due ${m.deadline.slice(0, 10)}` : null, m.next].filter((x) => x !== null).join("; ")}`),
    `Waiting for the owner: ${r.needsYou.length} decision(s) in Needs me, ${r.approvals} approval(s)`,
    `Resources: ${r.resources.running} of ${r.resources.maxConcurrent} runs at once, ${r.resources.waiting} waiting to start`,
    `Work for the CEO: ${assignLine(r.assign)}`,
  ];
  return lines.slice(0, 60).map((l) => cut(l));
}
