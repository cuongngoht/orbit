// WHERE Satellite keeps what it keeps: one room in the project's machine store, beside Orbit's own rooms, and never
// in a repository. The store root is Orbit's (cli/bind.mjs asks runtimeProject and machineContext for it); nothing
// here computes a repository key or names a home directory.
//
//   <storeRoot>/satellite/
//     definitions/{roles,agent-templates,skills,workflows}/<id>/<version>-<digest8>.json   immutable, one file each
//     registry/                 the one writer lock for registration, and sessions/<mark>.json (which mission a
//                               session runs); every index is REBUILT from the definition files on each read;
//                               selected/<id>.json (0.3.0) which kept version of an id is offered, when one was chosen
//     missions/<msn-id>/        journal.jsonl (the mission's ONLY state), goal.json, plans/, agent-runs/, handoffs/,
//                               artifacts/, evidence/, checkpoints/, running.json (a worker's lease)
//     knowledge/ lessons/       reusable findings a mission published, by reference
//     policy/settings.json      a person's limits and revocations: read here, written only through a door that
//                               proves a person (none ships in this release)
//     live/                     a viewer's own lease and pins, and nothing a mission reads
//
// Every path is held inside the room through symlinks (contained) and rooms are created on first WRITE, never on read.
import { join } from "node:path";
import { contained } from "../../../src/project/boundary.mjs";
import { checkedId } from "../../../src/store/id.mjs";

export const ROOT = "satellite";

export const MISSION_ID = { type: "string", pattern: "^msn-[a-f0-9]{12}$" };

export const isMissionId = (id) => new RegExp(MISSION_ID.pattern).test(String(id ?? ""));

// The four kinds of reusable definition, each in a room of its own, and the prefix its ids carry.
export const DEFINITION_KINDS = Object.freeze({ role: { dir: "roles", prefix: "rol" }, "agent-template": { dir: "agent-templates", prefix: "atp" }, skill: { dir: "skills", prefix: "skl" }, workflow: { dir: "workflows", prefix: "wft" } });

export const kindOfId = (id) => Object.keys(DEFINITION_KINDS).find((k) => String(id ?? "").startsWith(`${DEFINITION_KINDS[k].prefix}-`)) ?? null;

const inside = (root) => (rel) => contained(root, join(root, rel));

export function roomsOf(storeRoot) {
  const root = join(storeRoot, ROOT);
  const at = inside(root);
  return { root, missions: at("missions"), registry: at("registry"), selected: at(join("registry", "selected")), sessions: at(join("registry", "sessions")), knowledge: at("knowledge"), lessons: at("lessons"), policyFile: at(join("policy", "settings.json")), live: at("live"), definitions: Object.fromEntries(Object.entries(DEFINITION_KINDS).map(([kind, k]) => [kind, at(join("definitions", k.dir))])) };
}

export const missionDirOf = (rooms, id) => contained(rooms.missions, join(rooms.missions, checkedId(id, MISSION_ID)));

export const missionFile = (rooms, id, ...parts) => ((dir) => contained(dir, join(dir, ...parts)))(missionDirOf(rooms, id));

export const listMissions = (io, rooms) => io.list(rooms.missions).filter(isMissionId).sort();
