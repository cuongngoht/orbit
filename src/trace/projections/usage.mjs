// USAGE ANALYTICS -- how many commands ran, which ones, and how sessions flowed
// through them. A projection: a pure fold over the same trail events the
// decision trace reads, rebuilt on every read, storing nothing.
//
// Every ratio carries its DENOMINATOR (the coverage rule): a failure rate is
// `failed of runs`, never a bare percentage nobody can check. Every list is
// bounded and ordered deterministically, so the same trail always reads the
// same.
//
// Attribution is a HEURISTIC and says so: a command belongs to the skill that
// started most recently in the same session, until the next skill or the end of
// the session. (A subagent shares its parent's session id, so its work is
// attributed to the parent's skill.)
//
// The least-privilege view joins the trail with each skill's `allowed-tools`:
// a Orbit command a skill pre-approved and never ran in the window is a
// candidate to remove; one it ran without pre-approval was prompted every time.
import { collapsed, turnsOf } from "./turns.mjs";

export const TOP = 20;
export const PATHS = 10;
export const PATH_STEPS = 8;

const FLOW = ["skill", "agent", "orbit", "shell"];

const bare = (id) => String(id ?? "").split(":").at(-1);

// opts: { allowed: Map(skill → allowed-tools strings), sinceMs?, untilMs? }
export function usageOf(events, opts = {}) {
  const turns = turnsOf(events, { limit: Infinity });
  const attributed = attributedBySkill(events);
  return { window: windowOf(events, opts), totals: totalsOf(events, turns), commands: commandsOf(events), shell: shellOf(events), skills: skillsOf(events, attributed), transitions: transitionsOf(turns), paths: pathsOf(turns), failures: failuresOf(turns), privilege: privilegeOf(opts.allowed ?? new Map(), attributed) };
}

const windowOf = (events, opts) => ({ from: opts.sinceMs ? new Date(opts.sinceMs).toISOString() : events[0]?.at ?? null, to: opts.untilMs ? new Date(opts.untilMs).toISOString() : events.at(-1)?.at ?? null, events: events.length });

const of = (events, type) => events.filter((e) => e.type === type);

function totalsOf(events, turns) {
  const runs = of(events, "command.ran");
  const failed = runs.filter((e) => e.data.ok === false).length;
  return { sessions: new Set(events.map((e) => e.session)).size, turns: turns.filter((t) => t.prompt).length, orbit: runs.filter((e) => e.data.orbit).length, shell: runs.filter((e) => !e.data.orbit).length, tools: of(events, "tool.used").length, skills: of(events, "skill.invoked").length, agents: of(events, "agent.invoked").length, failed: { failed, of: runs.length } };
}

function grouped(events, keyOf, rowOf) {
  const groups = new Map();
  for (const e of events) groups.set(keyOf(e), [...(groups.get(keyOf(e)) ?? []), e]);
  return [...groups.values()].map(rowOf).sort((a, b) => b.runs - a.runs || (a.key < b.key ? -1 : 1)).slice(0, TOP);
}

const counted = (list) => ({ runs: list.length, failed: list.filter((e) => e.data.ok === false).length, sessions: new Set(list.map((e) => e.session)).size, last: list.at(-1).at });

const commandsOf = (events) => grouped(of(events, "command.ran").filter((e) => e.data.orbit), (e) => `${e.data.orbit} ${e.data.sub ?? ""}`, (list) => ({ key: `${list[0].data.orbit} ${list[0].data.sub ?? ""}`, id: list[0].data.orbit, sub: list[0].data.sub ?? null, ...counted(list) }));

const shellOf = (events) => grouped(of(events, "command.ran").filter((e) => !e.data.orbit), (e) => `${e.data.class}|${e.data.exe ?? ""}`, (list) => ({ key: `${list[0].data.class}|${list[0].data.exe ?? ""}`, class: list[0].data.class ?? "other", exe: list[0].data.exe ?? null, ...counted(list) }));

// skill → the Orbit commands (and their outcomes) that ran while it was the
// most recently started skill of its session.
function attributedBySkill(events) {
  const current = new Map();
  const out = new Map();
  for (const e of events) attributed(e, current, out);
  return out;
}

function attributed(e, current, out) {
  if (e.type === "skill.invoked" && e.data.outcome !== "refused") return void current.set(e.session, bare(e.data.id));
  if (e.type === "session.ended") return void current.delete(e.session);
  if (e.type !== "command.ran" || !current.has(e.session)) return;
  out.set(current.get(e.session), [...(out.get(current.get(e.session)) ?? []), e]);
}

function skillsOf(events, attributed) {
  const invoked = of(events, "skill.invoked");
  const ids = [...new Set(invoked.map((e) => bare(e.data.id)))];
  const rows = ids.map((id) => ({ id, invoked: invoked.filter((e) => bare(e.data.id) === id && e.data.outcome !== "refused").length, refused: invoked.filter((e) => bare(e.data.id) === id && e.data.outcome === "refused").length, commands: (attributed.get(id) ?? []).length, failed: (attributed.get(id) ?? []).filter((e) => e.data.ok === false).length }));
  return rows.sort((a, b) => b.invoked - a.invoked || (a.id < b.id ? -1 : 1)).slice(0, TOP);
}

const flowOf = (turn) => collapsed(turn.steps.filter((s) => FLOW.includes(s.kind))).map((s) => `${s.label}${s.ok === null ? " ?" : s.ok ? "" : " ✖"}`);

function transitionsOf(turns) {
  const pairs = new Map();
  for (const labels of turns.map(flowOf)) labels.slice(1).forEach((to, i) => pairs.set(`${labels[i]}\u0000${to}`, (pairs.get(`${labels[i]}\u0000${to}`) ?? 0) + 1));
  return [...pairs].map(([k, count]) => ({ from: k.split("\u0000")[0], to: k.split("\u0000")[1], count })).sort((a, b) => b.count - a.count || (a.from < b.from ? -1 : 1)).slice(0, TOP);
}

function pathsOf(turns) {
  const paths = new Map();
  for (const labels of turns.map(flowOf).filter((l) => l.length)) paths.set(labels.slice(0, PATH_STEPS).join(" → "), (paths.get(labels.slice(0, PATH_STEPS).join(" → ")) ?? 0) + 1);
  return [...paths].map(([path, turnsWith]) => ({ path, turns: turnsWith })).sort((a, b) => b.turns - a.turns || (a.path < b.path ? -1 : 1)).slice(0, PATHS);
}

// Which steps fail, of how many runs, and what the session did next.
function failuresOf(turns) {
  const all = turns.flatMap((t) => t.steps.filter((s) => FLOW.includes(s.kind)).map((s, i, list) => ({ s, next: list[i + 1]?.label ?? "(end of turn)" })));
  const failing = [...new Set(all.filter((x) => x.s.ok === false).map((x) => x.s.label))];
  return failing.map((label) => ({ label, failed: all.filter((x) => x.s.label === label && x.s.ok === false).length, of: all.filter((x) => x.s.label === label).length, followedBy: nextOf(all.filter((x) => x.s.label === label && x.s.ok === false)) })).sort((a, b) => b.failed - a.failed).slice(0, TOP);
}

const nextOf = (failed) => [...new Set(failed.map((x) => x.next))].map((label) => ({ label, count: failed.filter((x) => x.next === label).length })).sort((a, b) => b.count - a.count).slice(0, 3);

// `Bash(node <plugin root>/cli/resources.mjs route*)` → cli/resources + route.
const RULE = /^Bash\(\s*node\s+\S*?((?:cli|skills\/[a-z0-9-]+)\/(?:\*|[a-z0-9._-]+?))(?:\.mjs)?\*?(?:\s+([a-z][a-z-]*))?\*?\s*\)$/;

export const ruleOf = (text) => {
  const m = RULE.exec(String(text).trim());
  return m ? { rule: text, script: m[1], sub: m[2] ?? null } : null;
};

const covers = (rule, cmd) => (rule.script.endsWith("/*") ? cmd.data.orbit.startsWith(rule.script.slice(0, -1)) : rule.script === cmd.data.orbit) && (!rule.sub || rule.sub === cmd.data.sub);

function privilegeOf(allowed, attributed) {
  const skills = [...allowed.keys()].sort();
  const unused = skills.filter((s) => attributed.has(s)).flatMap((s) => (allowed.get(s) ?? []).map(ruleOf).filter(Boolean).filter((r) => !(attributed.get(s) ?? []).some((c) => c.data.orbit && covers(r, c))).map((r) => ({ skill: s, rule: r.rule })));
  const unapproved = skills.flatMap((s) => [...new Set((attributed.get(s) ?? []).filter((c) => c.data.orbit && !(allowed.get(s) ?? []).map(ruleOf).filter(Boolean).some((r) => covers(r, c))).map((c) => `${c.data.orbit}${c.data.sub ? ` ${c.data.sub}` : ""}`))].map((command) => ({ skill: s, command })));
  return { unused, unapproved, note: "a skill never started in this window is not judged — no evidence either way" };
}
