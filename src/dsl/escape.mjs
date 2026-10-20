// A ${PARAM} is spliced into text that something else then INTERPRETS -- a JS
// expression the page evaluates, a SQL statement the database runs, a regex.
// Substituting a value into source code blind is the bug: a thing called
// O'Brien turns `innerText.includes('${NAME}')` into a syntax error, and
// `WHERE Name='${NAME}'` into a different question that still returns rows.
//
// So each field DECLARES the language its text is in (`esc` in fields.mjs) and
// the value is encoded for that language. Only fields whose text reaches an
// interpreter are encoded: `value`, `key`, `file`, `why` and `url` travel as one
// argv element each to a child process spawned WITHOUT a shell, so they must
// arrive byte for byte -- escaping those would corrupt what gets typed.

// The placeholder sits INSIDE a quoted string in a real case, so what has to be
// safe is the inside of a literal -- whichever quote the author chose. A MAP,
// not a chain of replaces: replacing the backslash last would double every one
// the earlier rules had just added.
const JS_ESCAPE = {
  "\\": "\\\\",
  "'": "\\'",
  '"': '\\"',
  "`": "\\`",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

// Character by character, straight off the map: no character class to escape,
// and nothing special can be left out of it by accident. [...s] iterates code
// points, so a surrogate pair survives intact.

// `${` would open a substitution inside a template literal.
const JS_DOLLAR = /\$\{/g;

const REGEX_META = /[.*+?^${}()|[\]\\]/g;

export const ESCAPERS = {
  text: (v) => String(v),
  js: (v) => [...String(v)].map((c) => JS_ESCAPE[c] ?? c).join("").replace(JS_DOLLAR, "\\${"),
  // The one escape every SQL dialect agrees on. It is NOT parameter binding --
  // see src/dsl/sql-text.mjs and README 5.1 for what that buys and what it does not.
  sql: (v) => String(v).replace(/'/g, "''"),
  regex: (v) => String(v).replace(REGEX_META, "\\$&"),
};

export const encode = (v, esc) => (ESCAPERS[esc] ?? ESCAPERS.text)(v);
