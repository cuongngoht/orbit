// Bind the case's params to what the command line gave, defaults filling the rest.
import { Refused } from "./errors.mjs";

export function bindParams(c, given, warn) {
  const values = {};
  for (const p of c.params ?? []) bind(values, p, given);
  for (const k of Object.keys(given)) if (!(k in values)) warn(`! ${k} is not a param of ${c.id} — ignored`);
  return values;
}

// A param nobody gave, and nothing defaults, is UNBOUND -- not empty. Binding it
// to "" turned `WHERE Name='${NAME}'` into `WHERE Name=''`, a question the case
// never asked, and the empty answer read like a result. It is now exactly what
// it is: an unfilled placeholder, which the step refuses rather than asking
// something else. Declare a `default` for a param that is genuinely optional.
function bind(values, p, given) {
  if (p.required && !given[p.n]) throw new Refused(`missing param ${p.n}=… — ${p.desc ?? ""}`);
  const value = given[p.n] ?? p.default;
  if (value !== undefined) values[p.n] = value;
}
