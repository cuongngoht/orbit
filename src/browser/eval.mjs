// Evaluate JS in the page and poll predicates.
//
// `--raw eval` prints its result JSON-encoded ONCE, so ONE JSON.parse recovers
// it. Pass the BARE expression: wrapping it in JSON.stringify yourself
// double-encodes, every boolean comes back as the string "true", and a
// `=== true` poll silently never succeeds. An eval that threw comes back as its
// error text, which no predicate equals -- so a poll simply keeps polling.
export function createEval(session) {
  const ev = (js) => parseOnce(session.cli(["--raw", "eval", js], true));
  return { ev, truthy: (js) => ev(`!!(${js})`) === true };
}

// The LAST line is the result, because `--raw eval` prints exactly one. An
// ERROR is different: it is a message, sometimes several lines of one, and
// taking its last line threw away the "ERROR" marker and the sentence that
// mattered -- leaving classify() with "  playwright-cli open [params]", which it
// could not recognise, so a browser nobody had opened reported as a HOST.
//
// An object or an array is printed PRETTY, over several lines (measured on playwright-cli: `{`, a line per key,
// `}`), so the whole text is the result before the last line is: taking the last line alone reported every
// object a `report` returned as "}".
function parseOnce(raw) {
  const text = String(raw).trim();
  if (text.startsWith("ERROR")) return text;
  const whole = jsonOf(text);
  return whole.ok ? whole.value : lastLine(text);
}

const jsonOf = (text) => {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false }; }
};

function lastLine(text) {
  const last = text.split("\n").pop() ?? "";
  const it = jsonOf(last);
  return it.ok ? it.value : last;
}

// The polling loop used to live here, with its own Date.now -- so a deadline was
// measured by a clock no test could move while the message about it was measured
// by one that could. There is one loop now, in run/poll.mjs, clocked by ctx.now.
// No sleep between attempts there either: the round trip IS the pacing.
