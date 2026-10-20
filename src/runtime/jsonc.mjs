// JSON WITH COMMENTS, read with positions and edited by SPLICING -- never by
// parsing, changing and printing.
//
// A dev container definition is JSONC: a person comments why a feature is
// pinned, leaves a trailing comma, aligns things their own way. Reading it with
// JSON.parse and writing it back with JSON.stringify would erase every comment
// and re-flow the file, and a tool that does that to a file somebody wrote by
// hand is a tool they stop letting near it. So a document is read into a tree
// that remembers where every value starts and ends, and a change is a splice at
// those positions: the bytes outside the splice are the bytes that were there.
//
// What it can edit, and all it can: SET an existing value, INSERT a member into
// an object, APPEND an item to an array. Each keeps the file's own style --
// indentation (spaces or tabs, whatever its first indent is), a trailing comma
// where the file uses one, inline versus one-per-line -- and REFUSES, with a
// sentence, what it cannot do without losing something: replacing a value that
// has a comment inside it, filling a `{}` that has a comment in it, a duplicate
// key, a file that does not parse. A refusal is an answer the caller turns into
// "a person has to do this one", never a guess.
//
// `verify` is the check after a write: the edited text parses, has the value the
// edits describe applied to the original's value, and has exactly the original's
// comments. No dependency, no reflow, no key reordering.
import { canonicalJson } from "../hash.mjs";

const MAX_DEPTH = 64;

class Bad extends Error {}

// ---- scanning ----------------------------------------------------------------------------

function scan(text) {
  const out = { tokens: [], comments: [] };
  for (let i = 0; i < text.length;) i = step(text, i, out);
  return out;
}

function step(text, i, out) {
  const c = text[i];
  if (/\s|﻿/.test(c)) return i + 1;
  if (c === "/") return comment(text, i, out);
  if ("{}[]:,".includes(c)) return punct(c, i, out);
  return c === '"' ? string(text, i, out) : word(text, i, out);
}

function punct(c, i, out) {
  out.tokens.push({ type: c, start: i, end: i + 1 });
  return i + 1;
}

function comment(text, i, out) {
  const end = text[i + 1] === "/" ? lineEnd(text, i) : blockEnd(text, i);
  out.comments.push({ start: i, end });
  return end;
}

function lineEnd(text, i) {
  const at = text.indexOf("\n", i);
  return at < 0 ? text.length : at;
}

function blockEnd(text, i) {
  if (text[i + 1] !== "*") throw new Bad(`a stray "/" at ${where(text, i)}`);
  const at = text.indexOf("*/", i + 2);
  if (at < 0) throw new Bad(`a comment opened at ${where(text, i)} never closes`);
  return at + 2;
}

function string(text, i, out) {
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
  if (j >= text.length) throw new Bad(`a string opened at ${where(text, i)} never closes`);
  out.tokens.push({ type: "string", start: i, end: j + 1, value: decoded(text.slice(i, j + 1), text, i) });
  return j + 1;
}

function decoded(literal, text, i) {
  try {
    return JSON.parse(literal);
  } catch {
    throw new Bad(`the string at ${where(text, i)} is not valid`);
  }
}

const WORD = /[A-Za-z0-9+\-.]/;
const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

function word(text, i, out) {
  const j = wordEnd(text, i);
  const w = text.slice(i, j);
  out.tokens.push({ type: wordType(w, text, i), start: i, end: j, value: JSON.parse(w) });
  return j;
}

function wordEnd(text, i) {
  let j = i;
  while (j < text.length && WORD.test(text[j])) j++;
  return j;
}

function wordType(w, text, i) {
  if (NUMBER.test(w)) return "number";
  if (["true", "false", "null"].includes(w)) return "literal";
  throw new Bad(`unexpected "${text[i]}" at ${where(text, i)}`);
}

function where(text, at) {
  const before = text.slice(0, at).split("\n");
  return `line ${before.length}, column ${before.at(-1).length + 1}`;
}

// ---- parsing -----------------------------------------------------------------------------

// -> { ok: true, value, tree, comments } | { ok: false, error }
export function parse(text) {
  try {
    const source = String(text ?? "");
    const lexed = scan(source);
    const p = { source, t: lexed.tokens, i: 0, depth: 0 };
    const tree = value(p);
    if (p.i < p.t.length) throw new Bad(`more than one value: unexpected content at ${where(source, p.t[p.i].start)}`);
    return { ok: true, value: valueOf(tree), tree, comments: lexed.comments };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message };
    throw e;
  }
}

const KINDS = { "{": object, "[": array, string: scalar, number: scalar, literal: scalar };

function value(p) {
  const read = reader(p);
  if (++p.depth > MAX_DEPTH) throw new Bad(`nested more than ${MAX_DEPTH} levels deep`);
  const node = read(p);
  p.depth--;
  return node;
}

function reader(p) {
  const token = p.t[p.i];
  if (!token) throw new Bad("the document ends where a value was expected");
  if (!KINDS[token.type]) throw new Bad(`unexpected "${p.source.slice(token.start, token.end)}" at ${where(p.source, token.start)}`);
  return KINDS[token.type];
}

function scalar(p) {
  const token = p.t[p.i++];
  return { type: token.type === "string" ? "string" : token.type, start: token.start, end: token.end, value: token.value };
}

function expect(p, type) {
  const token = p.t[p.i];
  if (token?.type !== type) throw new Bad(`expected "${type}" at ${where(p.source, token?.start ?? p.source.length)}`);
  p.i++;
  return token;
}

const peek = (p, type) => p.t[p.i]?.type === type;

function object(p) {
  const open = expect(p, "{");
  const members = membersOf(p);
  const close = expect(p, "}");
  return { type: "object", start: open.start, end: close.end, members };
}

// The keys seen so far are a set: looking through every member for each new key is quadratic, and a
// definition with tens of thousands of them is the checkout's to write.
function membersOf(p) {
  const members = [];
  const seen = new Set();
  while (!peek(p, "}")) members.push(member(p, seen));
  return members;
}

function member(p, seen) {
  const key = keyOf(p, seen);
  expect(p, ":");
  const node = value(p);
  const comma = separator(p, "}");
  return { key: key.value, keyStart: key.start, node, comma };
}

function keyOf(p, seen) {
  const key = expect(p, "string");
  if (seen.has(key.value)) throw new Bad(`the key "${key.value}" is there twice, at ${where(p.source, key.start)}`);
  seen.add(key.value);
  return key;
}

// The comma after a member or an item, as its position -- or null at the end,
// where a trailing comma is allowed and its absence is too.
function separator(p, close) {
  const comma = peek(p, ",") ? p.t[p.i++] : null;
  if (!comma && !peek(p, close)) throw new Bad(`expected "," or "${close}" at ${where(p.source, p.t[p.i]?.start ?? p.source.length)}`);
  return comma?.start ?? null;
}

function array(p) {
  const open = expect(p, "[");
  const items = [];
  while (!peek(p, "]")) items.push(item(p));
  const close = expect(p, "]");
  return { type: "array", start: open.start, end: close.end, items };
}

function item(p) {
  const node = value(p);
  return { node, comma: separator(p, "]") };
}

export function valueOf(node) {
  if (node.type === "object") return Object.fromEntries(node.members.map((m) => [m.key, valueOf(m.node)]));
  return node.type === "array" ? node.items.map((i) => valueOf(i.node)) : node.value;
}

// The node at a path of keys and indexes, or null.
export function get(tree, path) {
  return path.reduce((node, step) => (node ? child(node, step) : null), tree);
}

function child(node, step) {
  if (node.type === "object") return node.members.find((m) => m.key === step)?.node ?? null;
  return node.type === "array" ? node.items[step]?.node ?? null : null;
}

// ---- editing -----------------------------------------------------------------------------

// edits: { op: "set", path, value } | { op: "insert", path, key, value } | { op: "append", path, value }
// -> { ok: true, text } | { ok: false, reason }
export function edit(text, edits) {
  let current = String(text ?? "");
  for (const e of edits) {
    const next = applied(current, e);
    if (!next.ok) return next;
    current = next.text;
  }
  return { ok: true, text: current };
}

const refuse = (reason) => ({ ok: false, reason });

function applied(text, e) {
  const found = located(text, e);
  if (found.ok === false) return found;
  const plan = OPS[e.op]?.(text, found.doc, found.target, e);
  if (!plan) return refuse(`${e.op} is not an edit this reader makes`);
  return plan.ok === false ? plan : { ok: true, text: spliced(text, plan) };
}

function located(text, e) {
  const doc = parse(text);
  if (!doc.ok) return refuse(`the file does not parse (${doc.error})`);
  const target = get(doc.tree, e.path ?? []);
  return target ? { doc, target } : refuse(`there is nothing at ${JSON.stringify(e.path)} to change`);
}

// Applied from the end of the text backwards, so no splice moves another. Two
// splices at one position are applied last-in-the-text first: a comma that goes
// after a value and a member that goes after the comma meet exactly there.
const spliced = (text, plan) => plan.splices.map((s, order) => ({ ...s, order })).sort((a, b) => b.at - a.at || b.order - a.order).reduce((t, s) => t.slice(0, s.at) + s.insert + t.slice(s.at + (s.remove ?? 0)), text);

const commentsIn = (doc, from, to) => doc.comments.filter((c) => c.start >= from && c.end <= to);

const OPS = { set, insert, append };

function set(text, doc, node, e) {
  if (commentsIn(doc, node.start, node.end).length) return refuse(`the value at ${JSON.stringify(e.path)} has a comment inside it, and replacing it would lose that`);
  return { splices: [{ at: node.start, remove: node.end - node.start, insert: written(e.value, indentAt(text, node.start), unitOf(text)) }] };
}

// `make(indent)` writes the new member or item for a line indented that far:
// where it goes decides how a value that spans lines is indented.
function insert(text, doc, node, e) {
  if (node.type !== "object") return refuse(`${JSON.stringify(e.path)} is not an object`);
  if (node.members.some((m) => m.key === e.key)) return refuse(`"${e.key}" is already there`);
  const make = (indent) => `${JSON.stringify(e.key)}: ${written(e.value, indent, unitOf(text))}`;
  return node.members.length ? after(text, doc, node, node.members.at(-1), make) : within(text, doc, node, make);
}

function append(text, doc, node, e) {
  if (node.type !== "array") return refuse(`${JSON.stringify(e.path)} is not an array`);
  const make = (indent) => written(e.value, indent, unitOf(text));
  return node.items.length ? after(text, doc, node, node.items.at(-1), make) : within(text, doc, node, make);
}

// A new LAST member or item. The file's own style decides the shape: one per
// line when the last one starts its line, inline when it does not, and a comma
// after the new one when the file already leaves one after its last.
function after(text, doc, container, last, make) {
  const commaed = last.comma !== null;
  const here = trailing(text, doc, commaed ? last.comma + 1 : last.node.end);
  const lead = leadAfter(text, container, last, here);
  const piece = make(lead === " " ? indentAt(text, container.start) : lead.slice(1));
  return commaed ? { splices: [{ at: here.at, insert: `${lead}${piece},` }] } : { splices: [{ at: last.node.end, insert: "," }, { at: here.at, insert: `${lead}${piece}` }] };
}

function leadOf(text, container, last) {
  const inline = !text.slice(container.start, startOf(last)).includes("\n");
  return inline ? " " : `\n${indentAt(text, startOf(last))}`;
}

// A line comment runs to the end of its line, so a member written INLINE after one would become part
// of it and vanish: that one goes on a line of its own.
function leadAfter(text, container, last, here) {
  const lead = leadOf(text, container, last);
  return lead === " " && here.line ? `\n${indentAt(text, startOf(last))}` : lead;
}

const startOf = (entry) => entry.keyStart ?? entry.node.start;

// Where the text after a value's line comment ends, so a comment stays at the
// end of the line it was written on and the new member goes after it.
// -> { at, line }: where that is, and whether what ends there is a LINE comment.
function trailing(text, doc, end) {
  const eol = lineEnd(text, end);
  const same = doc.comments.find((c) => c.start >= end && c.start < eol && text.slice(end, c.start).trim() === "");
  return same ? { at: same.end, line: text.startsWith("//", same.start) } : { at: end, line: false };
}

// Into an empty `{}` or `[]`, which may hold whitespace but nothing else.
function within(text, doc, container, make) {
  if (commentsIn(doc, container.start, container.end).length) return refuse("it is empty but has a comment inside, and filling it would move that");
  const inner = text.slice(container.start + 1, container.end - 1);
  return { splices: [{ at: container.start + 1, remove: inner.length, insert: shaped(text, container, inner, make) }] };
}

function shaped(text, container, inner, make) {
  const parent = indentAt(text, container.start);
  if (!inner.includes("\n")) return make(parent);
  return `\n${parent}${unitOf(text)}${make(`${parent}${unitOf(text)}`)}\n${parent}`;
}

// The leading whitespace of the line a position is on.
function indentAt(text, pos) {
  const from = text.lastIndexOf("\n", pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(from, pos))[0];
}

// The file's own indentation unit: its first indented line, a tab or a run of
// spaces. Two spaces when it has no indented line at all.
function unitOf(text) {
  const first = /^([ \t]+)\S/m.exec(text.replace(/^﻿/, ""));
  return first ? (first[1].startsWith("\t") ? "\t" : first[1]) : "  ";
}

// A value as it is written: a scalar on one line, a collection one entry per
// line, indented from where it is going.
function written(value, indent, unit) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const body = JSON.stringify(value, null, unit);
  return body.split("\n").map((line, n) => (n ? `${indent}${line}` : line)).join("\n");
}

// ---- verifying ---------------------------------------------------------------------------

// The check after a write. -> { ok } | { ok: false, why }
export function verify(before, after, edits) {
  const was = parse(before);
  const now = parse(after);
  const why = !was.ok || !now.ok ? `the ${was.ok ? "edited" : "original"} text does not parse` : mismatch(was, now, edits);
  return why ? { ok: false, why } : { ok: true };
}

function mismatch(was, now, edits) {
  if (was.comments.length !== now.comments.length) return `the file had ${was.comments.length} comment(s) and now has ${now.comments.length}`;
  return canonicalJson(expectedValue(was.value, edits)) === canonicalJson(now.value) ? null : "the edited file does not hold what the edits describe";
}

// The same edits applied to a plain value, which is what the file should now say.
function expectedValue(value, edits) {
  const copy = structuredClone(value);
  for (const e of edits) CHANGES[e.op]?.(copy, e.path ?? [], e);
  return copy;
}

const at = (root, path) => path.reduce((v, step) => v?.[step], root);

const CHANGES = {
  set: (root, path, e) => {
    const holder = at(root, path.slice(0, -1));
    if (holder) holder[path.at(-1)] = e.value;
  },
  insert: (root, path, e) => {
    at(root, path)[e.key] = e.value;
  },
  append: (root, path, e) => {
    at(root, path).push(e.value);
  },
};
