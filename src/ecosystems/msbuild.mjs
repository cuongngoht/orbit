// A TOLERANT reader for MSBuild's XML -- enough of it to find items and
// properties, and nothing that pretends to be a parser.
//
// There is no XML parser in a zero-dependency engine, and this does not grow
// into one. It answers four questions about well-formed files the way a parser
// would, and about a torn file it answers LESS rather than something else: an
// element that never closes is simply not found. That is the fail-soft line --
// a malformed project costs its own dependencies, reported as such, and never
// a crash or a guess.
//
// Comments go first, and that is a correctness rule rather than tidiness: a
// reference somebody commented out is exactly a dependency the project does NOT
// have, and a reader that counted it would report a technology on the strength
// of a line nobody builds.

// Every pattern below is asked so that one attempt costs what it reads and no more. A pattern that
// waits for a closer is only asked as far as the LAST closer: an opening after it can never close, and
// asking from each of thousands of them would read to the end of the file every time -- quadratic, in
// a file that is the checkout's to write. A tag never crosses a `<` (well-formed XML has none inside
// one), and an attribute name is only tried where a name starts.
const closedUpTo = (s, closer) => (s.lastIndexOf(closer) < 0 ? 0 : s.lastIndexOf(closer) + closer.length);

export const withoutComments = (text) => {
  const s = String(text);
  const end = closedUpTo(s, "-->");
  return s.slice(0, end).replace(/<!--[\s\S]*?-->/g, "") + s.slice(end);
};

export const isProject = (text) => /<Project\b/.test(text);

// Attribute order is free in XML, and so is the quote character.
export const attributes = (tag) => Object.fromEntries([...String(tag).matchAll(/(?<![\w.-])([A-Za-z_][\w.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]));

// Every opening tag of one element, as its attributes -- self-closing or not.
export const elements = (text, name) => [...String(text).matchAll(new RegExp(`<${name}\\b([^<>]*?)/?>`, "g"))].map((m) => attributes(m[1]));

// Every item group with its own attributes, so a Condition on the group reaches
// each item in it. A group that never closes is not a group.
export const itemGroups = (text) => {
  const s = String(text);
  return [...s.slice(0, closedUpTo(s, "</ItemGroup>")).matchAll(/<ItemGroup\b([^<>]*)>([\s\S]*?)<\/ItemGroup>/g)].map((m) => ({ attrs: attributes(m[1]), body: m[2] }));
};

// The text of every property element of that name, trimmed.
export const values = (text, name) => [...String(text).matchAll(new RegExp(`<${name}\\b[^<>]*>([^<]*)</${name}>`, "g"))].map((m) => m[1].trim());

// An MSBuild list is `;`-separated and may carry whitespace and empty members.
export const listOf = (value) => String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
