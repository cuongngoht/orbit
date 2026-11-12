// THE SELF-CHECK: the evaluator proves its own outcome words without a model. A campaign of scripted arms runs through
// the SAME runner, containers, network, egress check and grader a coding host would, on one orders pack and one lending
// pack, and every run must end on the word its control predicts -- else the evaluator is not to be trusted with a
// model's runs.
//
//   selfcheckCampaign(o) -> campaign definition        SELF_CONTROLS        judgedSelfcheck(report) -> [{ key, expect, got, ok }]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LABEL, listByLabel } from "../core/docker.mjs";
import { readJournal } from "../core/journal.mjs";
import { TRAIL_FILE } from "../core/trail.mjs";
import { evalHome, nowIso, writeJson } from "../core/util.mjs";
import { roomOf, startCampaign } from "./campaign.mjs";

export const DEFAULT_PACKS = ["pack:orders-e2e-006", "pack:lending-hld-001"];

// arm -> [definition, expected word, expected INFRA code (or null), on every pack or only the first]
export const SELF_CONTROLS = {
  "gold-done": [{ kind: "scripted", behaviour: "patch", patch: "gold", status: "DONE" }, "RESOLVED", null, "all"],
  "noop-done": [{ kind: "scripted", behaviour: "noop", status: "DONE" }, "EMPTY_PATCH", null, "all"],
  "half-blocked": [{ kind: "scripted", behaviour: "patch", patch: "half", status: "BLOCKED" }, "UNRESOLVED", null, "all"],
  "half-done": [{ kind: "scripted", behaviour: "patch", patch: "half", status: "DONE" }, "FALSE_DONE", null, "all"],
  "tamper-done": [{ kind: "scripted", behaviour: "patch", patch: "tamper", status: "DONE" }, "FALSE_DONE", null, "all"],
  "regress-done": [{ kind: "scripted", behaviour: "patch", patch: "regress", status: "DONE" }, "REGRESSED", null, "all"],
  killed: [{ kind: "scripted", behaviour: "sleep", status: "NONE", killAfterSeconds: 8 }, "INFRA_ERROR", "KILLED", "first"],
  "over-time": [{ kind: "scripted", behaviour: "sleep", status: "NONE", minutes: 0.5 }, "TIMEOUT", null, "first"],
  "no-api": [{ kind: "scripted", behaviour: "noop", status: "DONE", egressAllow: ["no-such-host.invalid"] }, "INFRA_ERROR", "EGRESS", "first"],
  // mini-SWE-agent's own deterministic model, on the host, acting in a container with no network: both mini arms.
  "mini-gold": [{ kind: "mini", deterministic: "gold" }, "RESOLVED", null, "first"],
  "mini-orbit-gold": [{ kind: "mini+orbit", rev: "HEAD", deterministic: "gold" }, "RESOLVED", null, "first"],
  // The seat: seated with the plugin's own adoption command, a run grades as before; a seat that writes the checkout
  // ends the run before any agent.
  "seat-gold-done": [{ kind: "scripted", behaviour: "patch", patch: "gold", status: "DONE", seat: "plugin", rev: "HEAD" }, "RESOLVED", null, "first"],
  "seat-writes": [{ kind: "scripted", behaviour: "patch", patch: "gold", status: "DONE", seat: "writes-checkout" }, "INFRA_ERROR", "SEAT", "first"],
};

export function selfcheckCampaign(o = {}) {
  const tasks = o.tasks ?? DEFAULT_PACKS;
  const controls = Object.fromEntries(Object.entries(SELF_CONTROLS).filter(([arm]) => !o.controls || o.controls.includes(arm)));
  const runs = Object.entries(controls).flatMap(([arm, [, , , where]]) => (where === "all" ? tasks : tasks.slice(0, 1)).map((task) => ({ arm, task, trial: 1 })));
  return { schema: 1, id: o.id ?? `selfcheck-${nowIso().replace(/[^0-9]/g, "").slice(0, 14)}`, budgetUsd: 0, limits: { usd: 0, turns: 10, minutes: 10, cpus: 2, memoryMb: 2048, pids: 512 }, arms: Object.fromEntries(Object.entries(controls).map(([arm, [def]]) => [arm, def])), runs, ...(o.controls ? {} : { tracks: [{ id: "memory", arm: "noop-done", tasks: [tasks[0], tasks[0]] }] }), ...(o.keepImages ? { keepImages: true } : {}), ...(o.caFile ? { caFile: o.caFile } : {}) };
}

export function judgedSelfcheck(report) {
  return report.runs.map((r) => {
    const [, word, code] = SELF_CONTROLS[r.arm];
    const gotCode = r.word === "INFRA_ERROR" ? String(r.why ?? "").split(":")[0] : null;
    return { key: r.key, expect: code ? `${word} (${code})` : word, got: gotCode ? `${r.word} (${gotCode})` : r.word, ok: r.word === word && (!code || gotCode === code), why: r.why };
  });
}

// After the campaign, nothing of it is left on the daemon: every container and network it made was removed.
function leftoverRow(id) {
  const left = [...listByLabel("container", LABEL.campaign, id), ...listByLabel("network", LABEL.campaign, id)];
  return { key: "(cleanup: nothing of the campaign left on the daemon)", expect: "0 left", got: `${left.length} left`, ok: left.length === 0, why: left.join(", ") || null };
}

// A memory track keeps one store across its runs: after its two runs the scripted agent's own log in it has two lines.
function trackRow(o, id) {
  const file = join(roomOf(o.home ?? evalHome(), id), "tracks", "memory", "work", "orbit-store", "scripted-runs.log");
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).length : 0;
  return { key: "(memory track: one store carried across its 2 runs)", expect: "2 lines", got: `${lines} lines`, ok: lines === 2, why: null };
}

// The mini+orbit control listed the plugin's skills to the agent and ran one of the plugin's commands through the shell.
function miniPluginRow(o, id) {
  const lines = readJournal(join(roomOf(o.home ?? evalHome(), id), "journal.jsonl")).filter((l) => l.kind === "ended" && /^mini-orbit-gold__/.test(l.run));
  const s = lines.at(-1)?.summary;
  const got = s ? `${s.skillsListed ?? 0} skills listed, ${s.orbit?.commands ?? 0} plugin command(s)` : "no run";
  return { key: "(mini+orbit: the skills listed, a plugin command run)", expect: "skills listed, >= 1 command", got, ok: (s?.skillsListed ?? 0) > 0 && (s?.orbit?.commands ?? 0) >= 1, why: null };
}

// The seated control's seat ran, held, left the checkout as it was, and bound the checkout in the run's store (the
// plugin's binding file, state/checkouts/<id>.json).
function seatRow(o, id) {
  const s = readJournal(join(roomOf(o.home ?? evalHome(), id), "journal.jsonl")).filter((l) => l.kind === "ended" && /^seat-gold-done__/.test(l.run)).at(-1)?.seat;
  const bound = (s?.store ?? []).some((p) => /^state\/checkouts\/[^/]+\.json$/.test(p));
  const got = s ? `exit ${s.exit}, checkout ${s.unchanged ? "unchanged" : `changed (${s.changed.join(", ")})`}, ${bound ? "binding file in the store" : "no binding file"}` : "no seat recorded";
  return { key: "(seat: the plugin's adoption command, before the agent)", expect: "exit 0, unchanged, bound", got, ok: Boolean(s?.holds && s.unchanged && bound), why: s?.why ?? null };
}

// The seated control's agent played a host to the plugin's own hooks: the plugin's trail was kept in the run's room as
// metadata, with the prompt it saw and the plugin command it saw run.
function trailRow(o, id) {
  const room = roomOf(o.home ?? evalHome(), id);
  const ended = readJournal(join(room, "journal.jsonl")).filter((l) => l.kind === "ended" && /^seat-gold-done__/.test(l.run)).at(-1);
  const t = ended?.trail;
  const kept = Boolean(ended) && readdirSync(join(room, "runs")).some((d) => d.startsWith("seat-gold-done") && existsSync(join(room, "runs", d, `a${ended.attempt}`, TRAIL_FILE)));
  const got = t ? `${t.events} event(s), ${t.byType?.["prompt.submitted"] ?? 0} prompt(s), ${t.commands?.["cli/help"] ?? 0} plugin command(s), file ${kept ? "kept" : "absent"}` : "no trail recorded";
  return { key: "(seat: the plugin's trail kept in the room, as metadata)", expect: "a prompt, a plugin command, kept", got, ok: Boolean(t && kept && t.byType?.["prompt.submitted"] >= 1 && t.commands?.["cli/help"] >= 1), why: null };
}

export async function selfcheck(o) {
  const def = selfcheckCampaign(o);
  const file = join(o.scratchDir, `${def.id}.json`);
  writeJson(file, def);
  const report = await startCampaign(file, o);
  return { id: def.id, rows: [...judgedSelfcheck(report), ...(def.tracks ? [trackRow(o, def.id)] : []), ...(def.arms["mini-orbit-gold"] ? [miniPluginRow(o, def.id)] : []), ...(def.arms["seat-gold-done"] ? [seatRow(o, def.id), trailRow(o, def.id)] : []), leftoverRow(def.id)] };
}
