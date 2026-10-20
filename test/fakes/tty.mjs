// A TERMINAL a test can hold: stdin that can be typed into and put in raw mode, stdout that keeps every byte
// written and can be resized or made to fail, and the signals a process would get. What `live tui` is handed
// instead of process.stdin, process.stdout and process.
import { EventEmitter } from "node:events";

export function fakeTty(opts = {}) {
  const stdin = Object.assign(new EventEmitter(), { isTTY: opts.isTTY ?? true, raw: [], paused: false, setRawMode(on) { this.raw.push(on); return this; }, resume() { this.paused = false; return this; }, pause() { this.paused = true; return this; } });
  const stdout = Object.assign(new EventEmitter(), { isTTY: opts.isTTY ?? true, columns: opts.columns ?? 120, rows: opts.rows ?? 34, writes: [], failing: false });
  stdout.write = (text) => written(stdout, text);
  const signals = new EventEmitter();
  return { stdin, stdout, signals, term: opts.term ?? "xterm-256color", colour: opts.colour ?? false, type: (text) => stdin.emit("data", Buffer.from(text, "utf8")), resize: (columns, rows) => resized(stdout, columns, rows), all: () => stdout.writes.join("") };
}

function written(stdout, text) {
  if (stdout.failing) throw Object.assign(new Error("write EIO"), { code: "EIO" });
  stdout.writes.push(String(text));
  return true;
}

function resized(stdout, columns, rows) {
  Object.assign(stdout, { columns, rows });
  stdout.emit("resize");
}

// The screen a terminal would show after these bytes: positions, clearing a row or the screen, and text. Enough
// to read a frame back; it ignores colour.
export function screenOf(bytes, columns, rows) {
  const s = { grid: Array.from({ length: rows }, () => Array(columns).fill(" ")), r: 0, c: 0 };
  const re = /\u001b\[([0-9;?]*)([A-Za-z])|([^\u001b])/gsu;
  for (const m of String(bytes).matchAll(re)) stepped(s, m, columns, rows);
  return s.grid.map((line) => line.join("").trimEnd());
}

function stepped(s, m, columns, rows) {
  if (m[3] !== undefined) return printed(s, m[3], columns, rows);
  if (m[2] === "H") Object.assign(s, { r: Number(m[1].split(";")[0]) - 1, c: Number(m[1].split(";")[1] ?? 1) - 1 });
  if (m[2] === "K") s.grid[s.r] = Array(columns).fill(" ");
  if (m[2] === "J" && m[1] === "2") s.grid = Array.from({ length: rows }, () => Array(columns).fill(" "));
}

function printed(s, ch, columns, rows) {
  if (ch === "\r" || ch === "\n") return;
  if (s.r < rows && s.c < columns) s.grid[s.r][s.c] = ch;
  s.c += 1;
}

// Timers a test fires by hand: what `live tui` schedules (its paint, its feed tick, its list refresh, a retry),
// held in a table, so a test says when time passes and can count what is still scheduled after the viewer left.
export function fakeTimers() {
  const live = new Map();
  const next = { id: 0 };
  const add = (fn, ms, repeat) => ((id) => (live.set(id, { fn, ms, repeat }), id))(++next.id);
  return {
    setInterval: (fn, ms) => add(fn, ms, true),
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearInterval: (id) => live.delete(id),
    clearTimeout: (id) => live.delete(id),
    active: () => live.size,
    fire: (ms = null) => [...live].filter(([, t]) => ms === null || t.ms === ms).forEach(([id, t]) => (t.repeat ? null : live.delete(id), t.fn())),
  };
}
