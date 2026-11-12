// THE SELF-CHECK: the evaluator proves its own outcome words without a model. A campaign of scripted arms runs through
// the SAME runner, containers, network, egress check and grader a coding host would, on one orders pack and one lending
// pack, and every run must end on the word its control predicts -- else the evaluator is not to be trusted with a
// model's runs.
//
//   selfcheckCampaign(o) -> campaign definition        SELF_CONTROLS        judgedSelfcheck(report) -> [{ key, expect, got, ok }]
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LABEL, listByLabel } from "../core/docker.mjs";
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
};

export function selfcheckCampaign(o = {}) {
  const tasks = o.tasks ?? DEFAULT_PACKS;
  const controls = Object.fromEntries(Object.entries(SELF_CONTROLS).filter(([arm]) => !o.controls || o.controls.includes(arm)));
  const runs = Object.entries(controls).flatMap(([arm, [, , , where]]) => (where === "all" ? tasks : tasks.slice(0, 1)).map((task) => ({ arm, task, trial: 1 })));
  return { schema: 1, id: o.id ?? `selfcheck-${nowIso().replace(/[^0-9]/g, "").slice(0, 14)}`, budgetUsd: 0, limits: { usd: 0, turns: 1, minutes: 10, cpus: 2, memoryMb: 2048, pids: 512 }, arms: Object.fromEntries(Object.entries(controls).map(([arm, [def]]) => [arm, def])), runs, ...(o.controls ? {} : { tracks: [{ id: "memory", arm: "noop-done", tasks: [tasks[0], tasks[0]] }] }), ...(o.keepImages ? { keepImages: true } : {}), ...(o.caFile ? { caFile: o.caFile } : {}) };
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

export async function selfcheck(o) {
  const def = selfcheckCampaign(o);
  const file = join(o.scratchDir, `${def.id}.json`);
  writeJson(file, def);
  const report = await startCampaign(file, o);
  return { id: def.id, rows: [...judgedSelfcheck(report), ...(def.tracks ? [trackRow(o, def.id)] : []), leftoverRow(def.id)] };
}
