// Find function bodies in masked source: every `{` that follows `)` (unless
// the `(` belongs to if/for/while/switch/catch/with) or `=>`.
const BLOCK_WORDS = new Set(["if", "for", "while", "switch", "catch", "with"]);
const WORD_BEFORE = /([A-Za-z_$][\w$]*)\s*$/;

export function functionBodies(masked) {
  const bodies = [];
  const stack = [];
  for (let i = 0; i < masked.length; i++) visit(masked, i, stack, bodies);
  return bodies.filter((b) => b.end !== undefined);
}

function visit(masked, i, stack, bodies) {
  const c = masked[i];
  if (c === "{") return stack.push(open(masked, i, bodies));
  if (c === "}") return close(stack.pop(), i);
}

function open(masked, i, bodies) {
  const kind = kindOf(masked, i);
  const body = { start: i, kind: kind.kind, name: kind.name };
  if (kind.kind === "function") bodies.push(body);
  return body;
}

const close = (body, i) => { if (body) body.end = i; };

function kindOf(masked, i) {
  const before = masked.slice(0, i).replace(/\s+$/, "");
  if (before.endsWith("=>")) return { kind: "function", name: arrowName(before) };
  if (before.endsWith(")")) return afterParens(before);
  return { kind: "block" };
}

function afterParens(before) {
  const open = matchingParen(before, before.length - 1);
  const head = before.slice(0, open).replace(/\s+$/, "");
  const word = WORD_BEFORE.exec(head)?.[1] ?? "";
  if (BLOCK_WORDS.has(word)) return { kind: "block" };
  return { kind: "function", name: word === "function" ? functionName(head) : word || "(anonymous)" };
}

function matchingParen(text, closeAt) {
  let depth = 0;
  for (let k = closeAt; k >= 0; k--) {
    depth += text[k] === ")" ? 1 : text[k] === "(" ? -1 : 0;
    if (depth === 0) return k;
  }
  return 0;
}

const functionName = (head) => WORD_BEFORE.exec(head.replace(/function\s*\*?\s*$/, "").replace(/\s+$/, ""))?.[1] ?? "(anonymous)";

// `const label = (s) =>` / `x: () =>` / `.map((v) =>` -- take the identifier
// the arrow is assigned to, if any.
function arrowName(before) {
  const head = before.slice(0, -2).replace(/\s+$/, "");
  const params = head.endsWith(")") ? head.slice(0, matchingParen(head, head.length - 1)) : head.replace(/[\w$]+$/, "");
  const m = /([A-Za-z_$][\w$]*)\s*[=:]\s*(?:async\s*)?$/.exec(params.replace(/\s+$/, ""));
  return m?.[1] ?? "(arrow)";
}
