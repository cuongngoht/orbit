// The COMMANDS this CLI answers, each a row: what it runs over the ports, how it is said, and whether it needs the
// project's store at all (`needs: "nothing"` runs anywhere, even outside a checkout).
import { Refused } from "../../src/errors.mjs";
import { flag, has, words } from "../../src/learn/args.mjs";
import { hostRowOf, hostsMatrix, CAPABILITIES } from "./hosts/matrix.mjs";
import { ENVELOPE_API, ENVELOPE_FIELDS } from "./hosts/envelope.mjs";
import { REPORT_API, REPORT_FIELDS, REPORT_FORBIDDEN, REPORT_LIMITS } from "./hosts/report.mjs";
import { contextOf, eventsView, goalOf, listOf, protocolOf, showOf } from "./mission/context.mjs";
import { envelopeFor } from "./mission/envelope.mjs";
import { finish } from "./mission/finish.mjs";
import { start, step } from "./mission/loop.mjs";
import { reconcile } from "./mission/reconcile.mjs";
import { agentAck, agentReport } from "./mission/report.mjs";
import { MODES, MODE_VOCABULARY } from "./execution/modes.mjs";
import { UNIT_KINDS } from "./execution/unit-kinds.mjs";
import { ACTION_STATUSES } from "./execution/vocab.mjs";
import { EVIDENCE_LEVELS } from "./evidence/vocab.mjs";
import { OPERATION_KINDS } from "./permissions/operations.mjs";
import { PROFILES } from "./permissions/profiles.mjs";
import { DEFINITION_KINDS } from "./store/rooms.mjs";
import { STOP_REASONS, KIND_NAMES } from "./mission/vocab.mjs";
import { TRIGGERS } from "./planning/replan.mjs";
import { EVENT_API, EVENT_FIELDS } from "./projection/event.mjs";
import { worldOf } from "./mission/world.mjs";
import { NOT_SATELLITE } from "./governance.mjs";
import { quietly } from "./store/text.mjs";

const parsedJson = (text, what) => {
  try { return JSON.parse(text); }
  catch { throw Object.assign(new Refused(`${what} is not JSON — send one object on stdin or with --${what}=<file>`), { code: "NOT_JSON" }); }
};

const inputOf = (io, args, name) => parsedJson(io.input(flag(args, name)), name);

const idArg = (args, i = 0) => words(args)[i] ?? "";

const goalTextOf = (io, args) => (flag(args, "file") ? io.file(flag(args, "file")) : has(args, "stdin") ? io.input(null) : words(args).join(" "));

const say = (r) => JSON.stringify(r, null, 2);

const envelope = (ports, args) => envelopeFor(ports, worldOf(ports, idArg(args)), idArg(args, 1));

const definitionsOf = (ports, args) => Object.keys(DEFINITION_KINDS).filter((k) => !flag(args, "kind") || k === flag(args, "kind")).flatMap((k) => ports.definitions.index(k).map((r) => ({ kind: k, pin: r.pin, id: r.id, version: r.version, name: r.record?.content?.displayName ?? r.record?.content?.capability ?? null, eligibility: r.eligibility })));

const capabilitiesOf = (ports, args) => ((host) => ({ host, detected: ports.hostId, row: hostRowOf(host, ports.acceptance.passed), acceptance: { receipts: ports.acceptance.receipts, stale: ports.acceptance.stale, digest: ports.acceptance.digest }, capabilities: CAPABILITIES }))(flag(args, "host") ?? ports.hostId);

export const PROTOCOL = () => ({ ...protocolOf(), envelope: { api: ENVELOPE_API, fields: ENVELOPE_FIELDS }, report: { api: REPORT_API, fields: REPORT_FIELDS, forbidden: REPORT_FORBIDDEN, limits: REPORT_LIMITS }, event: { api: EVENT_API, fields: EVENT_FIELDS }, modes: { vocabulary: MODE_VOCABULARY, modes: MODES }, unitKinds: UNIT_KINDS, operationKinds: OPERATION_KINDS, profiles: PROFILES, actionStatuses: ACTION_STATUSES, evidenceLevels: EVIDENCE_LEVELS, stops: STOP_REASONS, triggers: TRIGGERS.map((t) => ({ id: t.id, at: t.at, response: t.response })), journalKinds: KIND_NAMES, notSatellite: NOT_SATELLITE });

export const COMMANDS = Object.freeze({
  "mission.start": { run: (ports, args) => ((r) => ({ ...r, next: `mission context ${r.mission}` }))(start(ports, { goal: goalTextOf(ports.input, args) })), say },
  "mission.context": { run: (ports, args) => contextOf(ports, idArg(args)), say },
  "mission.step": { run: (ports, args) => step(ports, idArg(args), inputOf(ports.input, args, "decision")), say, resolves: true },
  "mission.reconcile": { run: (ports, args) => reconcile(ports, idArg(args), { abandon: flag(args, "abandon") }), say },
  "mission.finish": { run: (ports, args) => finish(ports, idArg(args), { stop: flag(args, "stop"), because: flag(args, "because") }), say },
  "mission.show": { run: (ports, args) => showOf(ports, idArg(args)), say },
  "mission.goal": { run: (ports, args) => goalOf(ports, idArg(args)), say },
  "mission.events": { run: (ports, args) => eventsView(ports, idArg(args), Number(flag(args, "since") ?? 0)), say },
  "mission.list": { run: (ports) => ({ missions: listOf(ports) }), say },
  "agent.envelope": { run: envelope, say },
  "agent.ack": { run: (ports, args) => agentAck(ports, idArg(args), idArg(args, 1)), say },
  "agent.report": { run: (ports, args) => agentReport(ports, idArg(args), idArg(args, 1), inputOf(ports.input, args, "report")), say },
  "definitions.list": { run: (ports, args) => ({ definitions: definitionsOf(ports, args) }), say },
  "definitions.show": { run: (ports, args) => ports.definitions.read(idArg(args)), say },
  "host.capabilities": { run: capabilitiesOf, say },
  "host.detect": { run: (ports) => ({ host: ports.hostId, matrix: quietly(() => hostsMatrix(ports.acceptance.passed)) }), say },
  settings: { run: (ports) => ({ policy: ports.policy, orbit: { execution: ports.limits.values.execution, skillFactory: ports.limits.values.skillFactory } }), say },
  where: { run: (ports) => ({ store: ports.rooms.root, missions: ports.rooms.missions, definitions: ports.rooms.definitions, registry: ports.rooms.registry, policy: ports.rooms.policyFile, live: ports.rooms.live, project: ports.project }), say },
  protocol: { needs: "nothing", run: () => PROTOCOL(), say },
});

export const commandOf = (argv) => ((two, one) => (COMMANDS[two] ? { name: two, entry: COMMANDS[two], args: argv.slice(2) } : COMMANDS[one] ? { name: one, entry: COMMANDS[one], args: argv.slice(1) } : null))(`${argv[0]}.${argv[1]}`, argv[0]);
