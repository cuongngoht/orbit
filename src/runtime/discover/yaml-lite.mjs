// A TOLERANT reader for the YAML subset that container files, task runners and
// pipeline definitions are written in -- enough of it to find a service's image,
// the ports it publishes, what a pipeline runs on and which tasks a file
// defines, and nothing that pretends to be a parser.
//
// There is no YAML parser in a zero-dependency engine, and this does not grow
// into one. It answers a few questions about well-formed files the way a parser
// would, and about a file it cannot read it answers LESS rather than something
// else, and SAYS what it skipped in `notes`. That is the fail-soft line the
// MSBuild reader (src/ecosystems/msbuild.mjs) draws: a file this cannot read
// costs its own facts, reported as such, and never a crash or a guess.
//
// Read: block mappings and sequences by indentation (a sequence may sit at its
// key's own indent, as compose files write it), plain and quoted scalars,
// `key: value` inside a sequence item, single- and multi-line flow collections,
// block scalars (kept as one string, approximately), comments, and the first
// document of a stream. Not read, and said: anchors, aliases, tags, tab
// indentation. A plain number that has a decimal point stays a STRING, because
// `3.10` is a version and not the number 3.1.
//
// -> { value, notes }. Never throws.
export function parseYaml(text) {
  const state = { lines: logicalLines(String(text ?? "")), at: 0, depth: 0, notes: new Set() };
  const value = state.lines.length ? node(state, state.lines[0].indent) : null;
  return { value, notes: [...state.notes] };
}

function logicalLines(text) {
  const out = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (/^(---|\.\.\.)(\s|$)/.test(raw) && out.length) break;
    const line = withoutComment(raw);
    if (line.trim() && !/^(---|\.\.\.)(\s|$)/.test(line)) out.push({ indent: line.length - line.trimStart().length, text: line.trim() });
  }
  return out;
}

function withoutComment(line) {
  const at = commentAt(line);
  return at < 0 ? line : line.slice(0, at);
}

function commentAt(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    quote = quoteAfter(quote, line, i);
    if (!quote && line[i] === "#" && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

function quoteAfter(quote, line, i) {
  const c = line[i];
  if (quote) return c === quote && line[i - 1] !== "\\" ? null : quote;
  return c === '"' || c === "'" ? c : null;
}

const isItem = (text) => text === "-" || text.startsWith("- ");

// How deep a block, or a flow collection inside one, may nest. A real file is a handful of levels; a
// hostile one is a stack, and every level is several frames. Past this the rest is dropped and SAID --
// the file answers less, and the reader never throws.
const MAX_DEPTH = 64;

function node(state, indent) {
  if (state.depth >= MAX_DEPTH) return tooDeep(state);
  state.depth++;
  const value = block(state, indent);
  state.depth--;
  return value;
}

function tooDeep(state) {
  state.notes.add(`nesting deeper than ${MAX_DEPTH} levels was not read`);
  state.at = state.lines.length;
  return null;
}

function block(state, indent) {
  const line = state.lines[state.at];
  if (!line || line.indent < indent) return null;
  if (isItem(line.text)) return sequence(state, line.indent);
  return split(line.text) ? mapping(state, line.indent) : plain(state, line);
}

// A line that is neither an item nor `key: value`, where a value was expected:
// one scalar, which is what a multi-line plain scalar's first line is.
function plain(state, line) {
  state.at++;
  return valueAfter(state, line.text, line.indent);
}

// `key: rest` or null. A quoted key may hold a colon; a plain key ends at the
// first colon that is followed by a space or the end of the line, so `image:
// redis:7` is the key `image` and the value `redis:7`.
function split(text) {
  if (/^[[{]/.test(text)) return null;
  if (/^["']/.test(text)) return quotedKey(text);
  const at = colonAt(text);
  return at < 0 ? null : { key: text.slice(0, at).trim(), rest: text.slice(at + 1).trim() };
}

function colonAt(text) {
  for (let i = 0; i < text.length; i++) if (text[i] === ":" && (i === text.length - 1 || text[i + 1] === " ")) return i;
  return -1;
}

function quotedKey(text) {
  const end = text.indexOf(text[0], 1);
  if (end < 0 || text[end + 1] !== ":") return null;
  return { key: text.slice(1, end), rest: text.slice(end + 2).trim() };
}

function mapping(state, indent) {
  const out = {};
  for (let line = state.lines[state.at]; line && line.indent === indent && !isItem(line.text); line = state.lines[state.at]) entry(state, out, line, indent);
  return out;
}

function entry(state, out, line, indent) {
  const kv = split(line.text);
  state.at++;
  if (!kv) return void state.notes.add("a line that is not `key: value` was skipped where a mapping was expected");
  out[kv.key] = valueAfter(state, kv.rest, indent);
}

function valueAfter(state, rest, indent) {
  if (rest === "") return nested(state, indent);
  if (/^[|>]/.test(rest)) return blockScalar(state, indent);
  if (/^[[{]/.test(rest)) return flowFrom(state, rest);
  if (/^[&*!]/.test(rest)) return unsupported(state, rest, indent);
  return scalar(rest);
}

function nested(state, indent) {
  const next = state.lines[state.at];
  if (!next) return null;
  if (next.indent > indent) return node(state, next.indent);
  return next.indent === indent && isItem(next.text) ? sequence(state, indent) : null;
}

function sequence(state, indent) {
  const out = [];
  for (let line = state.lines[state.at]; line && line.indent === indent && isItem(line.text); line = state.lines[state.at]) out.push(item(state, line, indent));
  return out;
}

// `- key: value` is a mapping whose first line sits after the dash, and the
// rest of its keys line up under it: the line is rewritten to where its text
// really starts, and read as the mapping it is.
function item(state, line, indent) {
  const text = line.text.slice(1).trim();
  if (text === "") return (state.at++, nested(state, indent));
  if (!split(text) && !isItem(text)) return (state.at++, valueAfter(state, text, indent));
  state.lines[state.at] = { indent: indent + (line.text.length - text.length), text };
  return node(state, state.lines[state.at].indent);
}

// Every following line that is indented further than its key is the scalar's
// text. Comments and blank lines were already dropped, so this is approximate,
// and says so: nothing here depends on a script's exact text.
function blockScalar(state, indent) {
  const text = [];
  for (let line = state.lines[state.at]; line && line.indent > indent; line = state.lines[state.at]) {
    text.push(line.text);
    state.at++;
  }
  state.notes.add("a block scalar was read approximately: comments and blank lines inside it are gone");
  return text.join("\n");
}

// An anchor or a tag on its own is followed by the block it names, which is read
// as the block it is; an alias, or a tag with a value, keeps its raw text.
function unsupported(state, rest, indent) {
  state.notes.add("an anchor, alias or tag was not resolved, and its raw text was kept");
  return /^[&!]\S*$/.test(rest) ? nested(state, indent) : rest;
}

// Whole numbers only: `3.10` is a version, and 3.1 is a different one.
const SCALARS = [
  [/^"/, (t) => unquoted(t, '"')],
  [/^'/, (t) => unquoted(t, "'")],
  [/^(true|false)$/i, (t) => t.toLowerCase() === "true"],
  [/^(null|~)$/i, () => null],
  [/^-?\d+$/, (t) => Number(t)],
];

function scalar(text) {
  const t = text.trim();
  const rule = SCALARS.find(([re]) => re.test(t));
  return rule ? rule[1](t) : t;
}

function unquoted(t, q) {
  const end = t.lastIndexOf(q);
  const body = t.slice(1, end > 0 ? end : t.length);
  return q === '"' ? body.replace(/\\(["\\])/g, "$1") : body.replace(/''/g, "'");
}

// ---- flow collections: [a, b] and {a: b} -------------------------------------------------

// A collection that is never closed is read to the end of what is there, but never past this many
// lines: a hostile file is not a reason to read the rest of a very large one.
const FLOW_LINES = 2000;

function flowFrom(state, rest) {
  const open = scanned({ depth: 0, quote: null }, rest);
  const parts = [rest];
  for (let n = 0; open.depth > 0 && state.lines[state.at] && n < FLOW_LINES; n++) parts.push(taken(state, open));
  return flowValue({ s: parts.join("").trim(), i: 0, depth: 0, notes: state.notes });
}

// The next line, as the text it adds, with what it opens and closes counted as it goes: counting the
// whole text again for every line added is quadratic, and the file is the checkout's.
function taken(state, open) {
  const added = ` ${state.lines[state.at++].text}`;
  scanned(open, added);
  return added;
}

// What a stretch of text opens and closes, carrying a quote across the stretches.
function scanned(open, chunk) {
  for (let i = 0; i < chunk.length; i++) {
    open.quote = quoteAfter(open.quote, chunk, i);
    if (!open.quote) open.depth += "[{".includes(chunk[i]) ? 1 : "]}".includes(chunk[i]) ? -1 : 0;
  }
  return open;
}

const skip = (p) => {
  while (/\s/.test(p.s[p.i] ?? "x")) p.i++;
};

function flowValue(p) {
  skip(p);
  if (p.s[p.i] === "[") return inside(p, flowSequence);
  return p.s[p.i] === "{" ? inside(p, flowMapping) : flowScalar(p);
}

// A collection inside a collection, to a depth no real file has: past it the rest of the text is
// dropped and said, so `[[[[…` costs a counter and never a stack.
function inside(p, read) {
  if (p.depth >= MAX_DEPTH) return abandoned(p);
  p.depth++;
  const value = read(p);
  p.depth--;
  return value;
}

function abandoned(p) {
  p.notes.add(`nesting deeper than ${MAX_DEPTH} levels was not read`);
  p.i = p.s.length;
  return null;
}

// One element, and the proof that reading it moved on. A closer of the OTHER kind where this one is
// expected (`[a}`, `{a: b]`) consumes nothing, and a loop its own body does not move never ends: it
// is skipped and said, and it holds nothing.
function kept(p, read, keep) {
  const at = p.i;
  const value = read(p);
  comma(p);
  return p.i > at ? keep(value) : stray(p);
}

function stray(p) {
  p.notes.add("a bracket that closes nothing was skipped inside a flow collection");
  p.i++;
}

function flowSequence(p) {
  const out = [];
  for (p.i++, skip(p); p.i < p.s.length && p.s[p.i] !== "]"; skip(p)) kept(p, flowValue, (value) => out.push(value));
  p.i++;
  return out;
}

function comma(p) {
  skip(p);
  if (p.s[p.i] === ",") p.i++;
}

function flowMapping(p) {
  const out = {};
  for (p.i++, skip(p); p.i < p.s.length && p.s[p.i] !== "}"; skip(p)) kept(p, flowPair, (pair) => Object.assign(out, pair));
  p.i++;
  return out;
}

function flowPair(p) {
  const key = flowScalar(p, ":");
  if (p.s[p.i] === ":") p.i++;
  const value = flowValue(p);
  comma(p);
  return { [String(key)]: value };
}

// Up to a delimiter that is not inside quotes: a comma or a closing bracket,
// and for a key the colon as well.
function flowScalar(p, extra = "") {
  const start = p.i;
  let quote = null;
  for (; p.i < p.s.length; p.i++) {
    quote = quoteAfter(quote, p.s, p.i);
    if (!quote && (",]}".includes(p.s[p.i]) || (extra && p.s[p.i] === extra))) break;
  }
  return scalar(p.s.slice(start, p.i));
}
