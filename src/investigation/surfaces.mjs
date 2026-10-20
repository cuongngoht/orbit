// What the UI MAP already says about a surface, read for an investigation:
// which controls only navigate, which may change data, and how to reach one.
//
// Nothing is guessed. A control writes when the map records an effect for it
// whose call is not a read; it only navigates when it opens something and no
// effect is recorded. A control that opens nothing and has no effect record is
// UNKNOWN, and unknown is treated as "may write" -- observe mode never clicks a
// control nobody can say is safe. A selector the map does not have is a
// control the investigation cannot touch; the fix is orbit-ui-map, not a guess.
import { edgeKey } from "../graph/index.mjs";

const NAVIGATES = new Set(["screen", "dialog", "panel", "external"]);
const INPUTS = new Set(["textbox", "combobox", "textarea", "searchbox", "spinbutton", "input"]);
const READ_CALL = /^\s*(GET|HEAD|OPTIONS)\b/i;

// -> { key, from, via, selector, kind, action ("click"|"fill"), writes, why, destructive, effect }
export function controlOf(graph, edge) {
  const effect = graph.effectOn.get(edgeKey(edge)) ?? null;
  const input = INPUTS.has(String(edge.kind).toLowerCase());
  return { key: edgeKey(edge), from: edge.from, via: edge.via, selector: usable(edge.selector), kind: edge.kind, action: input ? "fill" : "click", destructive: edge.destructive === true, effect, ...writing(edge, effect, input) };
}

const usable = (s) => (typeof s === "string" && s && s !== "UNKNOWN" ? s : null);

function writing(edge, effect, input) {
  if (input) return { writes: false, why: "an input: typing changes nothing until something commits it" };
  if (effect?.api && !READ_CALL.test(effect.api)) return { writes: true, why: `the map records ${effect.api}` };
  if (effect) return { writes: false, why: `the map records only ${effect.api ?? "a read"}` };
  if (NAVIGATES.has(edge.opens)) return { writes: false, why: `it opens a ${edge.opens}` };
  return { writes: true, why: "the map records no effect for it, so nobody can say it is safe" };
}

export const controlsOn = (graph, screenId) => graph.edges.filter((e) => e.from === screenId).map((e) => controlOf(graph, e));

// A screen's URL, when it is one a browser can go to: no {param} left in it.
export const concreteUrl = (screen) => (screen?.url && !/\{[^}]+\}/.test(screen.url) ? screen.url : null);

// How to get to a control: its own screen's URL, or -- for a dialog or a panel,
// which has none -- the one control on a screen with a URL that opens it.
// At most one hop, deliberately: a longer path is a case, not an exploration.
export function pathTo(graph, control) {
  const home = concreteUrl(graph.screens.get(control.from));
  if (home) return { url: home, via: [] };
  const opener = graph.edges.find((e) => e.to === control.from && concreteUrl(graph.screens.get(e.from)));
  return opener ? { url: concreteUrl(graph.screens.get(opener.from)), via: [controlOf(graph, opener)] } : null;
}

// The inputs a control's surface REQUIRES before it can commit -- what explore-
// write fills with synthetic TC- values and nothing else.
export const requiredInputs = (graph, control) => controlsOn(graph, control.from).filter((c) => c.action === "fill" && c.selector && graph.edgeOn.get(c.key)?.required === true);

// Every table the map says a control writes, for a data check to be held to.
export const mappedTables = (graph) => new Set(graph.effects.flatMap((e) => (e.layers?.sql ?? []).map((l) => String(l.table))));
export const tablesOf = (control) => (control?.effect?.layers?.sql ?? []).map((l) => String(l.table));
