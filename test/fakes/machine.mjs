// A machine for the runtime tests: tools that answer with a version, tools that
// are not there, a Docker daemon that is up, down, or too slow -- described as a
// small world and asked through the REAL detection and the REAL tool state, over a
// fake filesystem. Nothing here is a stand-in for the code under test: what is
// faked is the machine, which is the one thing a test cannot have.
import { createMachine, DETECTORS } from "../../src/runtime/machine.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { toolCatalog } from "../../src/tools/catalog.mjs";
import { createToolState } from "../../src/tools/state.mjs";
import { fakeIo } from "./io.mjs";
import { SHIPPED_TOOLS } from "./runtime.mjs";

export const TOOL_ROWS = toolCatalog(SHIPPED_TOOLS);

// What each tool prints when asked its version, by id: the shapes the catalog's
// own patterns read.
const BANNERS = {
  node: (v) => `v${v}`, python3: (v) => `Python ${v}`, go: (v) => `go version go${v} darwin/arm64`, java: (v) => `openjdk version "${v}" 2024-01-16`, ruby: (v) => `ruby ${v} (2024-01-01)`,
  make: (v) => `GNU Make ${v}`, docker: (v) => `Docker version ${v}, build abc1234`, task: (v) => `Task version: v${v}`, just: (v) => `just ${v}`,
};

const banner = (id, v) => (BANNERS[id] ?? ((x) => x))(v);

const binOf = (row) => row.detection.commands?.[0];

// `tools`: id -> a version (installed), false (not installed) or an Error (asked,
// and it did not answer). `docker-daemon`: a version (up), false (the CLI is there
// and the daemon is not) or "timeout".
export function fakeDetection(tools = {}, opts = {}) {
  const ran = [];
  const byPath = Object.fromEntries(TOOL_ROWS.filter((r) => binOf(r)).map((r) => [`/usr/bin/${binOf(r)}`, r.id]));
  const exists = (p) => p in byPath && typeof tools[byPath[p]] !== "undefined" && tools[byPath[p]] !== false;
  const run = (file, args) => (ran.push([file, ...args]), answer(file, args, byPath, tools));
  return { ran, detection: { env: { PATH: "/usr/bin" }, platform: opts.platform ?? "darwin", arch: "arm64", node: "/usr/bin/node", projectRoot: "/work/app", exists, read: () => "", run, detectors: DETECTORS, rooms: stateRooms("/store") } };
}

function answer(file, args, byPath, tools) {
  if (args[0] === "version" && args[1] === "--format") return daemon(tools["docker-daemon"]);
  const id = byPath[file];
  const v = tools[id];
  return v instanceof Error ? { error: v } : { status: 0, stdout: banner(id, v), stderr: "" };
}

function daemon(v) {
  if (v === "timeout") return { error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }) };
  return v ? { status: 0, stdout: `${v}\n`, stderr: "" } : { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
}

// -> { machine, probed: ids asked, ran: every command run, io }
export function fakeMachine(tools = {}, opts = {}) {
  const io = fakeIo({ now: () => opts.now ?? "2026-10-03T10:00:00.000Z" });
  const { detection, ran } = fakeDetection(tools, opts);
  const state = createToolState(stateRooms("/store"), io);
  const machine = createMachine({ catalog: TOOL_ROWS, state, detection, now: () => opts.now ?? "2026-10-03T10:00:00.000Z", platform: opts.platform ?? "darwin", arch: "arm64" });
  return { machine, ran, io, state };
}
