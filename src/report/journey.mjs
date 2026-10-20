import { isVerdict } from "../dsl/verbs.mjs";
import { label } from "../run/printer.mjs";
import { scrubbed } from "../scrub.mjs";
import { shotLink } from "./gallery.mjs";

export function journey(m, shots) {
  const source = m.run.source?.steps;
  const planned = Array.isArray(source) ? source.map((s, n) => ({ ...scrubbed(s), i: n + 1 })) : m.steps;
  return planned.map((s) => row(s, m.steps.find((r) => r.i === s.i), m, shots));
}

function row(s, record, m, shots) {
  const step = record ?? s;
  return { i: s.i, what: step.why || label(step), do: step.do, ...state(s.i, record, m), shot: record ? shotLink(record, shots) : null, recorded: Boolean(record) };
}

function state(i, record, m) {
  if (record?.ok === false) return { tone: "warn", state: `Stopped: ${m.result.status ?? "unknown"}` };
  if (record?.ok === true) return { tone: "pass", state: isVerdict(record) ? "Verification held" : "Executed" };
  const slice = m.result.slice;
  if (slice?.whole === false && (i < slice.from || i > slice.to)) return { tone: "flat", state: "Outside slice" };
  return { tone: "flat", state: "No execution recorded" };
}
