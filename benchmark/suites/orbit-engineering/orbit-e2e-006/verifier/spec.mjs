// THE SPEC of ORBIT-E2E-006: what an order's note must be wherever an order is kept or shown, written from the goal's own
// words -- kept as given, returned when read back and after a restart, empty when none was given, drawn escaped in a
// paragraph of its own and not at all when empty -- and never from the fixture's code. Kept beside the probe and handed
// to no runner; the controller imports a FROZEN copy of it, and it never imports the target.
//
// One input creates an order through the API, reads it back through a store opened again on the same directory, and
// draws what it read; the answer names the note each time and the note paragraph the view drew (`none` when it drew
// none), with the customer, total and state paragraphs beside them, and each group judges the fields it is about.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the goal
export const CASE = "ORBIT-E2E-006";

export const GROUPS = {
  "kept": "an order created with a note returns it when it is created and when it is read back",
  "durable": "a note is still there when the store is opened again",
  "drawn": "the view draws a non-empty note in a paragraph of its own",
  "escaped": "a note is drawn escaped: &, <, >, \" and ' never reach the page as markup",
  "none": "an order with no note, or an empty one, has the empty note and no note paragraph",
  "unchanged": "the customer, the total and the state are drawn as before",
  "seeded": "seeded notes and customers",
};

// ---- the reference model, as the goal words it ---------------------------------------------------------------------------

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapedText = (text) => [...String(text)].map((ch) => ENTITIES[ch] ?? ch).join("");

const LINES = [{ qty: 2, unitMinor: 1250 }];

const noteOf = (i) => i.note ?? "";

export const answersOf = (i) => ["status=201", `created=${noteOf(i)}`, `read=${noteOf(i)}`, `view=${noteOf(i) ? escapedText(noteOf(i)) : "none"}`, `customer=${escapedText(i.customer)}`, "total=$25.00", "state=open"];

// ---- the checks written by hand ------------------------------------------------------------------------------------------

const asked = (note, customer = "Ada") => ({ call: "note", customer, lines: LINES, ...(note === undefined ? {} : { note }) });

const HAND = [
  ["kept", asked("leave at the back door"), ["status=201", "created=leave at the back door", "read=leave at the back door", "view=leave at the back door", "customer=Ada", "total=$25.00", "state=open"]],
  ["kept", asked("call when here"), ["status=201", "created=call when here", "read=call when here", "view=call when here", "customer=Ada", "total=$25.00", "state=open"]],
  ["durable", asked("second floor, ring twice"), ["status=201", "created=second floor, ring twice", "read=second floor, ring twice", "view=second floor, ring twice", "customer=Ada", "total=$25.00", "state=open"]],
  ["drawn", asked("x"), ["status=201", "created=x", "read=x", "view=x", "customer=Ada", "total=$25.00", "state=open"]],
  ["escaped", asked("<b>fragile</b>"), ["status=201", "created=<b>fragile</b>", "read=<b>fragile</b>", "view=&lt;b&gt;fragile&lt;/b&gt;", "customer=Ada", "total=$25.00", "state=open"]],
  ["escaped", asked(`Tom & Jerry's "box"`), ["status=201", `created=Tom & Jerry's "box"`, `read=Tom & Jerry's "box"`, "view=Tom &amp; Jerry&#39;s &quot;box&quot;", "customer=Ada", "total=$25.00", "state=open"]],
  ["escaped", asked("<script>alert(1)</script>"), ["status=201", "created=<script>alert(1)</script>", "read=<script>alert(1)</script>", "view=&lt;script&gt;alert(1)&lt;/script&gt;", "customer=Ada", "total=$25.00", "state=open"]],
  ["none", asked(undefined), ["status=201", "created=", "read=", "view=none", "customer=Ada", "total=$25.00", "state=open"]],
  ["none", asked(""), ["status=201", "created=", "read=", "view=none", "customer=Ada", "total=$25.00", "state=open"]],
  ["unchanged", asked("ok", "Ada & <Bob>"), ["status=201", "created=ok", "read=ok", "view=ok", "customer=Ada &amp; &lt;Bob&gt;", "total=$25.00", "state=open"]],
];

// What each group judges of an answer: the fields its sentence is about -- so a change that keeps the note but never
// draws it holds the keeping checks and fails the drawing ones. A seeded check judges every field.
const FIELDS = { kept: ["status=", "created=", "read="], durable: ["read="], drawn: ["view="], escaped: ["view="], none: ["created=", "read=", "view="], unchanged: ["customer=", "total=", "state="] };

const expectOf = (group, input) => ((all) => (FIELDS[group] ? { has: all.filter((f) => FIELDS[group].some((p) => f.startsWith(p))) } : { exactly: all }))(answersOf(input));

const FIXED = HAND.map(([group, input]) => ({ group, input, expect: expectOf(group, input) }));

// ---- a seeded generator, the same notes for the same seed ----------------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (r, n) => Math.floor(r() * n);

const ALPHABET = ["a", "b", "c", "o", "r", " ", " ", "1", "&", "<", ">", '"', "'", "/", "é", ".", ","];

const seededText = (r, n) => Array.from({ length: n }, () => ALPHABET[int(r, ALPHABET.length)]).join("").trim();

const seededInput = (r) => asked(r() < 0.15 ? undefined : seededText(r, int(r, 40)), r() < 0.3 ? seededText(r, 1 + int(r, 12)) || "Ada" : "Ada");

const seeded = (r) => ((input) => ({ group: "seeded", input, expect: { exactly: answersOf(input) } }))(seededInput(r));

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  return numbered([...FIXED, ...Array.from({ length: Math.max(16, samples) }, () => seeded(r))]);
}

// ---- the reference model, held to what the goal says in words ------------------------------------------------------------

export const selfTest = () => HAND.filter(([, input, want]) => JSON.stringify(answersOf(input)) !== JSON.stringify(want)).map(([group, input]) => `the reference model disagrees with the goal on ${group}: ${JSON.stringify(input.note)}`);
