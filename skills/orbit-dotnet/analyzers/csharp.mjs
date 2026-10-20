// Just enough of C#'s lexical shape to ask "does this CODE say X" -- and
// nothing that pretends to be a compiler.
//
// Comments and string literals go first, and both are safety rules rather than
// tidiness. A comment that mentions a client is not code that uses it. A string
// literal is where a connection string, a secret or a tenant URL lives, and an
// analyser that pattern-matched inside one could lift it into a fact -- so every
// pattern below runs over text in which each literal has already been EMPTIED.
// What survives is identifiers, keywords and punctuation.
//
// A regex over emptied text, not a parser: conservative on purpose. A construct
// this does not recognise is a usage not reported, which the fact's unknowns
// already allow for; a construct misread would be a usage invented.

const LEXEMES = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|@"(?:[^"]|"")*"|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])+'/g;

// Comments become a space, literals become an empty literal: `""` keeps a call's
// argument count readable, and nothing inside it survives.
export const code = (text) => String(text).replace(LEXEMES, (m) => (m.startsWith("/") ? " " : '""'));

// Comments gone, literals KEPT -- for the one reader that needs a literal's
// shape (a registration's own name), and that then accepts only a bare name.
export const withoutComments = (text) => String(text).replace(LEXEMES, (m) => (m.startsWith("/") ? " " : m));

const USING = /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/gm;

export const usings = (c) => [...c.matchAll(USING)].map((m) => m[1]);

// Imported, or written out in full at a use site.
export const hasNamespace = (c, ns) => usings(c).some((u) => u === ns || u.startsWith(`${ns}.`)) || c.includes(`${ns}.`);

export const word = (c, w) => new RegExp(`\\b${w.replace(/\./g, "\\.")}\\b`).test(c);

// The types this file declares -- so a registration of one elsewhere can be
// traced back to what this file uses.
export const defines = (c) => [...new Set([...c.matchAll(/\b(?:class|record|interface|struct)\s+([A-Za-z_]\w*)/g)].map((m) => m[1]))].sort();

// Which rows of a table the code matches, each row { re, ...what it means }.
export const matching = (c, rows) => rows.filter((r) => r.re.test(c));

// The identifiers a row's pattern actually found, for the fact's signals.
export const found = (c, re) => [...new Set([...c.matchAll(new RegExp(re.source, "g"))].map((m) => m[0].replace(/^[.:,\s]+|[\s<(\[]+$/g, "")))].slice(0, 6);
