// What each runtime command SAYS: its data put into words for a terminal.
//
// A command answers with data (so `--json` and Orbit Control read the same thing) and
// `say` turns it into lines. Nothing here decides anything -- every state it prints
// was decided by the module that owns it -- and nothing here prints a secret: a
// command's text is shown because it is evidence, an argument list because that is
// what would run, and never an environment, a header or a log line.
//
// Plain text, one idea per line, the decision or the state FIRST: a person reading a
// terminal should learn what is true before why.
import { agoSaid } from "./connectivity/states.mjs";

const pad = (rows) => {
  const width = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? "").length)));
  return rows.map((r) => `  ${r.map((cell, i) => String(cell ?? "").padEnd(width[i])).join("  ").trimEnd()}`);
};

const list = (label, items) => (items.length ? [label, ...items.map((i) => `  ${i}`)] : []);

const ago = (at) => (at ? at.replace("T", " ").replace(/\.\d+Z$/, "Z") : "never");

export const sayDiscover = (r) => [`RUNTIME ${r.decision.name} · ${r.state}`, `  ${r.decision.say}`, ...(r.decision.scan === "none" ? ["", "read: skipped — what is kept still answers this"] : readLines(r)), ...list("could not be read:", r.gaps), ...list("noted:", r.notes.slice(0, 8))].join("\n");

function readLines(r) {
  const verb = r.decision.writes ? "recorded" : "would be recorded";
  const kinds = Object.entries(r.byKind).map(([k, n]) => `${n} ${k}`).join(" · ");
  return ["", `${r.facts} fact(s) ${verb}${kinds ? ` — ${kinds}` : ""}`, ...(r.decision.dry ? ["--dry: nothing was written"] : [])];
}

export function sayStatus(s) {
  const head = [`RUNTIME ${s.checkout.name} · ${s.checkout.branch ?? "(no branch)"}${s.checkout.commit ? ` @ ${s.checkout.commit}` : ""} · host ${s.checkout.host}`, `understanding  ${s.understanding.state}  (${s.understanding.facts} fact(s), read ${ago(s.understanding.at)})`, `plan           ${s.plan.overall}  strategy ${s.plan.strategy} · ${s.plan.host.platform}/${s.plan.host.arch}`];
  return [...head, ...componentLines(s), ...osLines(s), ...list("running:", sessionLines(s)), ...list("ended on their own (the last session of each; `runtime status --json` names its log):", endedLines(s)), ...list("answering, and not Orbit's (reused, never stopped):", (s.external ?? []).map(externalLine)), ...list("servers the project is defined with:", s.services.map(serviceLine)), ...list("reach targets, as last observed (`runtime check <target>` asks again):", reachStatusLines(s.connectivity)), ...list("environments:", s.instances.map(instanceLine)), ...list("proposals open:", s.proposals.map((p) => `${p.id}  ${p.state}  ${p.because}`)), ...list("understanding is not current:", staleLines(s))].join("\n");
}

const externalLine = (e) => `${e.component}  EXTERNAL  ${e.provider ?? "-"}  ${e.readiness.state} (${e.readiness.probe.kind} ${e.readiness.probe.target})`;

const reachStatusLines = (c) => (c?.targets ?? []).flatMap((t) => t.checkFrom.map((p) => `${t.id}  ${observedLine(t.observations[p])}`));

// The matrix, per component and never one word for the project: what each requires decides a cell,
// and where the checkout's own files show it is built is said beneath it, as evidence.
function osLines(s) {
  const platforms = s.plan.platforms ?? [];
  const startable = s.plan.components.filter((c) => c.state !== "not-startable");
  if (!platforms.length || !startable.length) return [];
  const rows = startable.map((c) => [c.key, ...platforms.map((p) => c.os?.[p.id]?.state ?? "unknown"), notYes(c, platforms)]);
  return ["", `operating systems, natively (from what each component requires${startable.length < s.plan.components.length ? `; ${s.plan.components.length - startable.length} with nothing to start not shown` : ""}):`, ...pad([["component", ...platforms.map((p) => p.name), ""], ...rows]), ...(s.plan.osEvidence ?? []).map((e) => evidenceLine(e, platforms))];
}

const notYes = (c, platforms) => platforms.map((p) => c.os?.[p.id]).find((cell) => cell && cell.state !== "yes")?.because ?? "";

// How each kind of evidence is said: a pipeline is where it is built or run, a script what it is written for.
const SAID = { ci: "built or run on", script: "its scripts are written for" };

const evidenceLine = (e, platforms) => `  ${SAID[e.source] ?? "seen on"} ${e.os.map((id) => platforms.find((p) => p.id === id)?.name ?? id).join(", ")} (${e.evidence.join(", ")})`;

function componentLines(s) {
  const rows = s.plan.components.map((c) => [c.key, c.kind, c.state, c.provider ?? "-", (c.state === "ready" ? c.command?.argv.join(" ") : null) ?? c.because]);
  return rows.length ? ["", "components:", ...pad([["component", "kind", "state", "provider", "how it starts, or why not"], ...rows])] : ["", "components: none found"];
}

// A component's latest session that ENDED with nobody stopping it -- it exited, or its pid went to
// another process: nothing else in this text would say it is gone.
function endedLines(s) {
  const running = new Set(s.sessions.filter((x) => ["RUNNING", "AMBIGUOUS"].includes(x.state)).map((x) => x.component));
  const latest = Object.values(s.sessions.reduce((by, x) => (by[x.component] && by[x.component].requestedAt > x.requestedAt ? by : { ...by, [x.component]: x }), {}));
  return latest.filter((x) => !running.has(x.component) && ["STOPPED", "LOST"].includes(x.state) && !x.stoppedHow).map((x) => `${x.id}  ${x.component}  ${x.state}  ${x.why ?? ""}`);
}

const sessionLines = (s) => s.sessions.filter((x) => ["RUNNING", "AMBIGUOUS"].includes(x.state)).map((x) => `${x.id}  ${x.component}  ${x.state}  ${x.ownership}  pid ${x.pid ?? "-"}  ${x.readiness.state}${x.readiness.probe ? ` (${x.readiness.probe.source}: ${x.readiness.probe.kind} ${x.readiness.probe.target})` : ""}`);

const serviceLine = (v) => `${v.name && v.name !== v.service ? `${v.name} (${v.service})` : v.service}${v.port ? `  port ${v.port}  ${v.reachable ? "answering" : "not answering"}` : ""}${v.image ? `  (${v.image})` : ""}`;

const instanceLine = (i) => `${i.id}  ${i.provider}  ${i.state}${i.changed ? "  (edited since it was validated)" : ""}${i.validation?.because ? `  — ${i.validation.because}` : ""}`;

const staleLines = (s) => [...s.understanding.stale.map((p) => `${p} changed`), ...s.understanding.added.map((p) => `${p} appeared`), ...s.understanding.removed.map((p) => `${p} went away`), ...s.understanding.dirty.map((p) => `${p} has uncommitted edits`)];

export function sayDoctor(d) {
  const tools = Object.entries(d.machine.tools).map(([id, t]) => [id, t.state, t.version ?? "", t.reason ?? ""]);
  return [`DOCTOR ${d.machine.platform}/${d.machine.arch} · understanding ${d.understanding.state} · plan ${d.plan.overall}`, "", "tools asked:", ...(tools.length ? pad(tools) : ["  none: nothing here asks anything of the machine"]), ...d.providers.flatMap(providerLines)].join("\n");
}

function providerLines(p) {
  const checks = (p.checks ?? []).map((c) => [c.component ?? c.what, c.state, c.because ?? ""]);
  return ["", `${p.provider}:`, ...(checks.length ? pad(checks) : ["  nothing to check"])];
}

export function sayPrepare(r) {
  const plans = r.plans.flatMap((p) => [`${p.provider}:`, ...(p.host.length ? p.host.map((h) => `  host    ${h.say}`) : ["  host    nothing is missing"]), ...p.environment.map((e) => `  ${e.step}   ${e.say}`), `  repository: ${p.repository}`]);
  return [r.apply ? "PREPARE (applied)" : "PREPARE (a plan: nothing was done)", ...plans, ...(r.applied ?? []).map((a) => `${a.ok ? "done" : "NOT done"}  ${a.provider}  ${a.because}`)].join("\n");
}

// What adopting would WRITE, in full: a created file's text, and each edit of a patch -- a person
// reviews the bytes, never a summary of them.
export function sayProposal(p) {
  const files = [...p.files.create.flatMap((f) => [`create ${f.path}`, ...f.text.trimEnd().split("\n").map((l) => `    | ${l}`)]), ...p.files.patch.flatMap((f) => [`patch  ${f.path}  (${f.edits.length} edit(s); every other byte stays)`, ...f.edits.map(sayEdit)])];
  return [`ENVIRONMENT PROPOSAL ${p.id} · ${p.state}${p.status === "adopted" ? " · adopted" : ""}`, `  ${p.because}`, ...list("files:", files), ...list("gaps:", p.gaps.map((g) => `${g.id}  ${g.state}  ${g.because}`)), ...list("unresolved (a person decides):", p.unresolved.map((u) => `${u.id}  ${u.why}`)), ...list("risks:", p.risks), ...list("notes:", p.notes), "", p.state === "CREATE" || p.state === "PATCH" ? `adopt it yourself in Orbit Control (Runtime → proposal ${p.id} → Adopt) — it writes your checkout, a protected boundary only a person crosses` : "nothing to adopt"].join("\n");
}

// One edit: what it does, the key path it touches, and the value it leaves there.
const EDIT_WORDS = { insert: "add   ", set: "set   ", append: "append" };

const sayEdit = (e) => `    ${EDIT_WORDS[e.op] ?? e.op} ${[...e.path, ...(e.key === undefined ? [] : [e.key])].join(" › ")}  ${JSON.stringify(e.value)}`;

export const sayAdopt = (r) => [`ADOPTED ${r.instance.id} · ${r.instance.state}`, ...r.files.map((f) => `  ${f.created ? "created" : "patched"}  ${f.path}  (read back and verified)`), "", "adopted is not validated: `runtime validate` builds it", ...(r.files.length ? ["what Orbit reads of a checkout is what is COMMITTED: commit the file(s) once they are right, and `runtime discover` reads them"] : [])].join("\n");

export const sayValidate = (i) => [`VALIDATION ${i.id} · ${i.state}`, `  ${i.validation.because}`, ...(i.ended ?? []).map((e) => `  ended with the container it replaced: ${e.component} (session ${e.session}) — \`runtime start\` launches it again`), ...(i.validation.wrote ?? []).map((p) => `  the Dev Containers CLI wrote ${p} (the features it resolved, by digest) — commit it to pin them, or delete it; Orbit wrote nothing in the repository`), i.state === "VALIDATED" ? "" : "files are as they were written; the environment is NOT ready until it builds"].join("\n");

export function sayStart(r) {
  const reused = r.reused ?? [];
  const lines = [...r.started.flatMap((s) => [s.readiness?.exited ? `EXITED    ${s.component}  pid ${s.pid}  (${s.provider}, session ${s.session})  ${s.readiness.because}` : `started   ${s.component}  pid ${s.pid}  (${s.provider}, session ${s.session})${s.readiness ? `  ${s.readiness.state}` : ""}`, ...(s.withheld?.length ? [`          not handed to it (a value with a line break): ${s.withheld.join(", ")}`] : [])]), ...reused.map(sayReused), ...r.skipped.map((s) => `running   ${s.component}  already running (pid ${s.pid})`), ...r.blocked.map((b) => `BLOCKED   ${b.component}  ${b.blocking.join("; ")}`), ...r.notReady.map((n) => `not ready ${n.component}  ${n.state}: ${n.because}`)];
  const gone = r.started.filter((s) => s.readiness?.exited).length;
  return [`START ${r.started.length - gone} started${gone ? ` · ${gone} exited` : ""}${reused.length ? ` · ${reused.length} reused` : ""}`, ...(lines.length ? lines : ["  nothing to start"]), "", "RUNNING is not READY: `runtime status` says whether it answers"].join("\n");
}

// A reused component is somebody else's process: said as EXTERNAL, every time it is shown.
const sayReused = (s) => `reused    ${s.component}  EXTERNAL (${s.provider}, ${s.readiness.probe.kind} ${s.readiness.probe.target} answers)  not started by Orbit and never stopped by it`;

export function sayStop(r) {
  const lines = [...r.stopped.map((s) => `stopped   ${s.component}  (${s.how})${s.residual ? ` — ${s.residual}` : ""}`), ...r.gone.map((g) => `closed    ${g.component}  ${g.outcome === "gone" ? "it had already exited" : "the pid is another process's now; nothing was touched"}`), ...r.refused.map((x) => `REFUSED   ${x.component ?? x.session}  ${x.why}`), ...r.released.map((x) => `released  ${x.component}  (${x.session})`)];
  return [`STOP ${r.stopped.length} stopped`, ...(lines.length ? lines : [r.environment ? "  no session of Orbit's was running" : "  nothing of Orbit's is running here"]), ...(r.environment ? [`environment: ${r.environment.because}`] : [])].join("\n");
}

export function saySettings(r) {
  const comps = Object.entries(r.settings.components).map(([k, c]) => [k, c.provider ?? "-", c.command ?? "-", c.readiness ? `${c.readiness.kind} ${c.readiness.target}` : "-", (c.env ?? []).join(",")]);
  return [`SETTINGS for this machine · strategy ${r.settings.strategy} · reuse external ${r.settings.reuseExternal ? "on" : "off"} · revision ${r.revision ?? "none (nothing set yet)"}`, ...(comps.length ? pad([["component", "provider", "command", "readiness", "env"], ...comps]) : ["  no component settings"]), ...reachLines(r.settings.connectivity), ...(r.others.length ? [`other machines have settings too: ${r.others.join(", ")} (not applied here)`] : []), ...(r.notes ?? []).map((n) => `note: ${n}`)].join("\n");
}

const retryLine = (p) => `${p.attempts} attempt(s), ${p.intervalMs} ms apart, ${p.timeoutMs} ms each`;

// The servers it needs that are not its own, and how hard a check of each tries.
function reachLines(c) {
  const rows = Object.entries(c?.targets ?? {}).map(([id, t]) => [id, `${t.host}:${t.port}`, t.requiredBy.join(",") || "-", t.checkFrom.join(","), t.beforeStart ? "before start" : "-", t.retry ? retryLine({ ...c.retry, ...t.retry }) : "-"]);
  return [`connectivity: retry ${retryLine(c?.retry ?? { attempts: 0, intervalMs: 0, timeoutMs: 0 })}`, ...(rows.length ? pad([["target", "where", "required by", "checked from", "gate", "own retry"], ...rows]) : ["  no connectivity target"])];
}

export const sayForgotten = (f) => `FORGOTTEN ${f.checkout.root}, a checkout of ${f.project.name} whose directory is gone. What Orbit kept about it stays in the store`;

export const sayRecord = (r) => `RECORDED ${r.recorded} inference(s) — never certain, never counted against a machine, and a command among them is shown and never launched`;

const GONE = "  a checkout marked (missing) comes off this list with: runtime forget <its directory>";

export function sayProjects(list_) {
  const rows = list_.flatMap((p) => p.checkouts.map((c) => [p.name, c.summary?.branch ?? "", c.summary?.runtime ?? "NOT_DISCOVERED", c.summary?.understanding ?? "NOT_DISCOVERED", c.exists ? c.root : `${c.root} (missing)`]));
  const hint = list_.some((p) => p.checkouts.some((c) => !c.exists)) ? [GONE] : [];
  return rows.length ? ["PROJECTS on this machine", ...pad([["project", "branch", "runtime", "understanding", "checkout"], ...rows]), ...hint].join("\n") : "no project is known on this machine yet: Orbit is used from a checkout";
}

// ---- connectivity ------------------------------------------------------------------------------

const agoOf = agoSaid;

const NOT_A_LOGIN = "REACHABLE is not READY and not a login: a connection was accepted, and nothing was asked of what answered";

// One location's answer: what, when, after how many attempts, and STALE when it is too old to stand for now.
const observedLine = (o) => (o.state === "NOT_CHECKED" ? `${o.provider.padEnd(13)}NOT_CHECKED  ${o.because}` : `${o.provider.padEnd(13)}${o.state.padEnd(12)} ${agoOf(o.freshness.age)}${o.freshness.stale ? "  STALE — check again" : ""}  attempt ${o.attemptsUsed} of ${o.configuredAttempts}  ${o.because}`);

export function sayConnectivity(r) {
  const head = `CONNECTIVITY ${r.targets.length} target(s) · an answer stands for ${Math.round(r.freshMs / 60000)} min · retry ${retryLine(r.retry)}`;
  const body = r.targets.flatMap((t) => [`  ${t.id}  ${t.label} (${t.host}:${t.port})  ${t.protocol}  required by ${t.requiredBy.join(", ") || "nothing"}${t.beforeStart ? (t.requiredBy.length ? "  · checked before start" : "  · before start, but nothing requires it yet: it gates nothing") : ""}`, ...(t.note ? [`    note: ${t.note}`] : []), ...t.checkFrom.map((p) => `    ${observedLine(t.observations[p])}`)]);
  return [head, ...(body.length ? body : ["  no connectivity target is set for this machine: runtime configure --reach=<id> --address=<host> --port=<port> --human adds one"]), ...loginNote(r.targets.flatMap((t) => Object.values(t.observations)))].join("\n");
}

// Said where it could be misread: only beside an answer that IS reachable.
const loginNote = (observations) => (observations.some((o) => o?.state === "REACHABLE") ? ["", NOT_A_LOGIN] : []);

export function sayCheck(r) {
  const head = `${r.mode.toUpperCase()} ${r.target.id} · ${r.target.label} (${r.target.host}:${r.target.port}) · ${r.mode === "retry" ? `up to ${r.target.retry.attempts} attempt(s), ${r.target.retry.intervalMs} ms apart` : "one attempt from each location"}`;
  const lines = Object.values(r.results).flatMap((o) => [`  ${o.provider.padEnd(13)}${o.state.padEnd(12)} attempt ${o.attemptsUsed} of ${o.configuredAttempts}  ${o.because}`, ...(o.attempts.length > 1 ? o.attempts.map((a) => `      ${a.number}  ${a.state.padEnd(12)} ${a.because}`) : [])]);
  return [head, ...lines, ...loginNote(Object.values(r.results))].join("\n");
}
