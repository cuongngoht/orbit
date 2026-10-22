// SATELLITE LIVE in a terminal: a viewer of ONE mission's journal, and nothing else. It follows the journal by lines
// (Orbit Live's own follower, src/store/follow.mjs, with the journal's one keep-rule), names every line as an
// orbit.satellite.event/v1 event through the engine's own fold, and draws -- it writes nothing a mission reads, ever.
// Closed and opened again it starts from the first line (or from --since=o=<n>), so it never shows a line twice.
//
//   live status [<msn>] [--json]                            one look: the mission, its agents, factory, execution, evidence
//   live watch  [<msn>] [--plain|--jsonl] [--since=o=<n>] [--once]   every event as it is written, until the mission ends
//   live tui    [<msn>] [--ascii]                           the full-screen viewer (an interactive terminal only)
//   live open   [<msn>] [--print]                           the full-screen viewer beside this session (tmux, Windows Terminal, iTerm2, a window)
//   live where  [<msn>]
import { flag, has, words } from "../../src/learn/args.mjs";
import { clearDown, cursorUp } from "../../src/live/render/ansi.mjs";
import { createFollower } from "../../src/store/follow.mjs";
import { Refused } from "../../src/errors.mjs";
import { readSessions } from "../src/hosts/sessions.mjs";
import { jsonlLine } from "../src/live/render/jsonl.mjs";
import { plainLine } from "../src/live/render/plain.mjs";
import { screenLines } from "../src/live/render/screen.mjs";
import { liveViewOf } from "../src/live/view.mjs";
import { viewerStateOf } from "../src/live/viewer.mjs";
import { TERMINAL } from "../src/mission/vocab.mjs";
import { journalOf } from "../src/mission/world.mjs";
import { createProjection } from "../src/projection/fold.mjs";
import { journalLine } from "../src/store/line.mjs";
import { isMissionId, listMissions } from "../src/store/rooms.mjs";
import { quietly, refused } from "../src/store/text.mjs";
import { bindPorts } from "./bind.mjs";

export const POLL_MS = 500;

const createdAt = (ports, id) => quietly(() => journalOf(ports, id).read()?.[0]?.at) ?? "";

const newest = (ports, ids) => [...ids].sort((a, b) => createdAt(ports, a).localeCompare(createdAt(ports, b))).at(-1) ?? null;

// Which mission a viewer shows: the one named, else this session's latest, else the project's newest -- never a guess
// across projects.
function chosen(ports, args) {
  const named = words(args).find(isMissionId);
  const ofSession = readSessions(ports.io, ports.rooms, ports.session)?.missions?.at(-1) ?? null;
  const id = named ?? ofSession ?? newest(ports, listMissions(ports.io, ports.rooms));
  if (!id) throw refused(Refused, "NO_MISSION", "this project has no mission yet: node <satellite>/cli/satellite.mjs mission start \"<goal>\"");
  return id;
}

const projected = (ports, id) => ((p) => ((journalOf(ports, id).read() ?? []).forEach((r) => p.push(r)), p))(createProjection());

const viewOfProjection = (p, ports) => liveViewOf(p.model(), p.events(), ports?.sessionActivity?.(Date.now()) ?? null);

const viewerOf = (view, term) => viewerStateOf(view, { reads: 1, good: 1 }, term.nowMs());

function status(ports, args, term) {
  const view = viewOfProjection(projected(ports, chosen(ports, args)), ports);
  const lines = has(args, "json") ? [JSON.stringify(view, null, 2)] : screenLines(view, viewerOf(view, term), { columns: term.columns, colour: term.colour });
  term.write(`${lines.join("\n")}\n`);
}

// ---- watch: follow the journal, line by line --------------------------------------------------------------------

const sinceOf = (args) => Number(/^o=(\d{1,9})$/.exec(flag(args, "since") ?? "")?.[1] ?? 0);

const MODES = [
  { id: "jsonl", when: (args) => has(args, "jsonl") },
  { id: "plain", when: (args, term) => has(args, "plain") || !term.isTTY },
  { id: "screen", when: () => true },
];

const PRINT = {
  jsonl: (s, event) => s.term.write(`${jsonlLine({ event: "satellite-event", id: `o=${event.seq + 1}`, data: event })}\n`),
  plain: (s, event, record) => s.term.write(`${plainLine(event, record)}\n`),
  screen: () => {},
};

function painted(s) {
  const view = viewOfProjection(s.projection, s.ports);
  const lines = screenLines(view, viewerOf(view, s.term), { columns: s.term.columns, rows: s.term.rows, colour: s.term.colour });
  s.term.write(`${s.drawn ? `${cursorUp(s.drawn)}\r${clearDown()}` : ""}${lines.join("\n")}\n`);
  s.drawn = lines.length;
}

function drained(s) {
  const got = s.follower.pull();
  for (const item of got.items) ((event) => (event.seq >= s.since ? PRINT[s.mode](s, event, item.record) : null))(s.projection.push(item.record));
  if (s.mode === "screen" && got.items.length) painted(s);
  return got.items.length;
}

const finished = (s) => TERMINAL.includes(viewOfProjection(s.projection).mission.lifecycle);

async function turned(s) {
  drained(s);
  if (!finished(s) && !s.once && !s.stopped) await s.term.sleep(POLL_MS);
}

function ended(s) {
  drained(s);
  const reason = finished(s) ? "terminal" : s.stopped ? "stopped" : "once";
  if (s.mode === "jsonl") s.term.write(`${jsonlLine({ event: "end", data: { mission: s.id, reason, cursor: `o=${s.projection.model().position}` } })}\n`);
  return { mission: s.id, reason, cursor: `o=${s.projection.model().position}` };
}

async function watch(ports, args, term) {
  const id = chosen(ports, args);
  const s = { id, term, ports, follower: createFollower(ports.io, journalOf(ports, id).file, { parse: journalLine, keep: false }), projection: createProjection(), since: sinceOf(args), mode: MODES.find((m) => m.when(args, term)).id, once: has(args, "once"), stopped: false, drawn: 0 };
  term.onStop(() => Object.assign(s, { stopped: true }));
  while (!finished(s) && !s.once && !s.stopped) await turned(s);
  return ended(s);
}

const where = (ports, args, term) => ((id) => term.write(`${JSON.stringify({ mission: id, journal: journalOf(ports, id).file, store: ports.rooms.root, sessions: ports.session ? `${ports.rooms.sessions}/${ports.session}.json` : null, live: ports.rooms.live }, null, 2)}\n`))(chosen(ports, args));

const later = async (name) => (await import("./satellite-tui.mjs"))[name];

const LIVE = { status, watch, where, tui: async (ports, args, term) => (await later("tuiMain"))(ports, args, term, chosen(ports, args)), open: async (ports, args, term) => (await later("openMain"))(ports, args, term, chosen(ports, args)) };

const terminalOf = (env) => ({ isTTY: Boolean(process.stdout.isTTY), columns: process.stdout.columns || 100, rows: process.stdout.rows || 40, colour: Boolean(process.stdout.isTTY) && !env.NO_COLOR && env.TERM !== "dumb", write: (text) => process.stdout.write(text), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onStop: (fn) => process.once("SIGINT", fn), nowMs: () => Date.now(), env });

export async function main(env, argv) {
  const row = LIVE[argv[0]];
  if (!row) throw refused(Refused, "LIVE_COMMAND", "live is status, watch, tui, open or where");
  return row(bindPorts(env, process.cwd()), argv.slice(1), terminalOf(env));
}
