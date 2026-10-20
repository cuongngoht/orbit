// Can this requirement be met HERE? -- the question a resolver asks of a machine
// before anything is started, and the only place the answer is decided.
//
// Four answers, because there are four different things to do about them:
//
//   compatible     it can run
//   incompatible   it can NEVER run this way on this machine, however much is
//                  installed: a Windows-only component on another operating system,
//                  a classic framework in a Linux container. Nothing a person does
//                  to the machine changes it, so a preference cannot either
//   needs-host     it could, once a person acts: a tool is missing, or too old.
//                  The remediation says which
//   unknown        nothing here could tell: no catalog row, a tool nobody could ask,
//                  a range this engine cannot read. NEVER read as incompatible
//
// Pure: a requirement, a machine and the catalog in, an answer and its sentence
// out. A requirement a file only POSSIBLY declares (an image's base, an
// inference) is shown and never counted: it must not decide whether something runs.
import { judged } from "../ranges.mjs";
import { requirement as row } from "../catalog.mjs";

const answer = (state, because, extra = {}) => ({ state, because, ...extra });

// Held against the host itself.
export function onHost(req, world) {
  const entry = row(world.catalog, req.requirement);
  if (!entry) return answer("unknown", `no catalog row says what it takes to run ${req.requirement} here`);
  if (entry.os && !entry.os.includes(world.machine.platform)) return answer("incompatible", `${entry.name} can only be met on ${entry.os.map((id) => platformName(world.catalog, id)).join(" or ")}, and this machine is ${platformName(world.catalog, world.machine.platform)}`);
  if (!entry.tool) return answer("unknown", `nothing here can tell whether ${entry.name} is present`);
  return tooled(entry, req, world.machine.tools[entry.tool]);
}

function tooled(entry, req, tool) {
  if (!tool || tool.state === "UNKNOWN") return answer("unknown", `${entry.name} has not been asked about, or did not answer${tool?.reason ? ` (${tool.reason})` : ""}`, { tool: entry.tool });
  if (tool.state === "UNAVAILABLE") return answer("needs-host", `${entry.name} is not on this machine${tool.reason ? ` (${tool.reason})` : ""}`, { tool: entry.tool, remediation: `install ${entry.name}` });
  return versioned(entry, req, tool);
}

function versioned(entry, req, tool) {
  if (!tool.version) return answer("unknown", `${entry.name} is here but did not say which version`, { tool: entry.tool });
  const verdict = judged(tool.version, req.range);
  const states = { compatible: "compatible", incompatible: "needs-host", unknown: "unknown" };
  return answer(states[verdict.state], `${entry.name} ${tool.version}: ${verdict.why}`, { tool: entry.tool, version: tool.version, ...(verdict.state === "incompatible" ? { remediation: `install ${entry.name} ${req.range}` } : {}) });
}

// What binds a component that is being STARTED: its own requirements and the
// checkout's, that a file DECLARES and that it needs to RUN. A requirement that is
// only for developing and testing it, or one a file merely suggests, is a note.
export function bindingOf(component, shared) {
  const all = [...component.requirements, ...shared.requirements];
  const binds = (r) => r.confidence === "certain" && r.stage === "run";
  return { bound: all.filter(binds), notes: all.filter((r) => !binds(r)) };
}

const ORDER = ["incompatible", "needs-host", "unknown", "compatible"];

// The worst answer among several: incompatible beats needs-host beats unknown, and
// compatible is what is left when nothing is wrong. No requirement at all is
// UNKNOWN -- nothing evidences what the component needs, so nothing is claimed.
export function folded(results) {
  if (!results.length) return answer("unknown", "no file declares what it needs, so nothing can be claimed about running it");
  const worst = ORDER.find((s) => results.some((r) => r.state === s));
  const said = results.filter((r) => r.state === worst);
  return answer(worst, said.map((r) => r.because).join("; "), { blocking: [...new Set(said.flatMap((r) => r.blocking ?? (r.remediation ? [r.remediation] : [])))] });
}

// An operating system as a person calls it (the catalog's `platforms`), its id where the catalog has no row.
const platformName = (catalog, id) => catalog?.platforms?.find((p) => p.id === id)?.name ?? id;
