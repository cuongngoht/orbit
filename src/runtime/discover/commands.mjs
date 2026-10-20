// A command line, read for the one question that matters before Orbit starts
// anything: can it be launched as an ARGUMENT LIST, with no shell?
//
// The Process port never uses a shell (src/process/index.mjs): `args` is an array
// and reaches the child as argv, so a value holding `;` is an argument and never
// a second command. That is the property that makes it safe to start something
// a project's own file declares. It has a price, which is this file: a command
// that only means what its author meant WITH a shell -- a pipe, a chain, a
// variable, a glob, an environment prefix -- cannot be launched this way, and
// Orbit says so and does not launch it, never guessing at what was meant. The
// command is still SHOWN (it is evidence), and a person can run it themselves.
//
// What is read: whitespace-separated words, with single and double quotes
// holding a word together. What is refused, with the sentence that says which:
//
//   ; & | < > ( ) { } [ ] * ? \ $ `   a shell would treat these as syntax
//   ~ at the start of a word          a shell would expand it to a home directory
//   NAME=value before the command     an environment prefix, the likeliest place in
//                                     a repository for a credential to be typed
//   %NAME%                            a variable a Windows shell would expand
//
// Inside double quotes only `$` and a backtick are refused: they are the two a
// shell would still expand there.
export const MAX_COMMAND = 2048;
export const MAX_WORDS = 64;

const SHELL = /[;&|<>(){}[\]*?\\$`]/;
const ENV_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WINDOWS_VARIABLE = /%[A-Za-z_]\w*%/;

// -> { argv, unsafe }: the words and null, or [] and why not.
export function tokenize(text) {
  const line = String(text ?? "").trim();
  if (!line) return refused("it is empty");
  if (line.length > MAX_COMMAND) return refused(`it is longer than ${MAX_COMMAND} characters`);
  const read = scanned(line);
  return read.problem ? refused(read.problem) : judged(read.words);
}

const refused = (why) => ({ argv: [], unsafe: why });

function scanned(line) {
  const st = { words: [], word: null, quote: null, problem: null };
  for (const c of line) {
    feed(st, c);
    if (st.problem) break;
  }
  return finished(st);
}

const feed = (st, c) => (st.quote ? quoted(st, c) : bare(st, c));

function quoted(st, c) {
  if (c === st.quote) return void (st.quote = null);
  if (st.quote === '"' && "$`".includes(c)) return void (st.problem = `it uses "${c}" inside quotes, which a shell would expand`);
  st.word += c;
}

function bare(st, c) {
  if (/\s/.test(c)) return void flush(st);
  if (c === "'" || c === '"') return void Object.assign(st, { quote: c, word: st.word ?? "" });
  if (SHELL.test(c) || (c === "~" && st.word === null)) return void (st.problem = `it uses "${c}", which needs a shell`);
  st.word = (st.word ?? "") + c;
}

function flush(st) {
  if (st.word !== null) st.words.push(st.word);
  st.word = null;
}

function finished(st) {
  if (st.quote) st.problem ??= "it has a quote that never closes";
  flush(st);
  return st;
}

function judged(words) {
  if (words.length > MAX_WORDS) return refused(`it has more than ${MAX_WORDS} words`);
  if (ENV_PREFIX.test(words[0] ?? "")) return refused("it sets an environment variable before the command, which needs a shell");
  if (words.some((w) => WINDOWS_VARIABLE.test(w))) return refused("it uses a %VARIABLE%, which a shell would expand");
  return words.length ? { argv: words, unsafe: null } : refused("it is empty");
}

// A script's NAME, carried into an argument list by a template. Names are what a
// project calls its commands: letters, digits and `:._-`, starting with one that
// is not punctuation. Anything else is not put in front of a package manager.
const NAME = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/;

export const safeName = (name) => NAME.test(String(name));

// An argv TEMPLATE from the catalog with its `{name}` filled in. Only a safe name
// is ever substituted, and nothing else about the template is interpreted.
export const filled = (template, name) => (safeName(name) ? template.map((word) => word.replace("{name}", name)) : null);
