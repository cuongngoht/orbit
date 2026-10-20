// What a target framework NAME says about the runtime a unit needs -- the one
// piece of format knowledge the MSBuild adapter owns that is not "where in the
// file is it".
//
// The distinction it exists to make is the one a developer on another operating
// system pays for: a modern target (`net8.0`) runs wherever its runtime does,
// and a classic one (`net48`, or `<TargetFrameworkVersion>v4.8</…>`) is a
// different product -- a Windows component that no amount of the first one
// being installed will start. They are two requirements with two names, never
// one with a version number that happens to look alike.
//
//   net5.0 and later, netcoreapp3.1   -> `dotnet`           >= that version
//   net8.0-windows, when no modern    -> `dotnet-windows`   >= that version: the same SDK, and an
//   target names no platform                                application only Windows runs -- a
//                                                           desktop UI, most often
//   net48, net472, v4.8               -> `dotnet-framework` >= that version
//   netstandard2.0                    -> neither: a library runs on whatever
//                                        consumes it, and that is said
//
// A unit that targets BOTH is held to the modern requirement only: the modern
// target is the one a machine without the classic runtime can still run, and the
// presence of the other is said, not counted against it.
const WINDOWS = /^net(\d+)\.(\d+)-windows/i;
const MODERN = /^net(\d+)\.(\d+)(?:-[a-z]+.*)?$/i;
const OLD_CORE = /^netcoreapp(\d+\.\d+)$/i;
const COMPACT = /^net(\d)(\d)(\d)?$/i;
const VERSIONED = /^v(\d+\.\d+(?:\.\d+)?)$/i;
const STANDARD = /^netstandard\d+\.\d+$/i;

const CLASSES = [
  { name: "windows", read: (t) => WINDOWS.exec(t)?.slice(1, 3).join(".") ?? null },
  { name: "modern", read: (t) => MODERN.exec(t)?.slice(1, 3).join(".") ?? OLD_CORE.exec(t)?.[1] ?? null },
  { name: "framework", read: (t) => COMPACT.exec(t)?.slice(1).filter(Boolean).join(".") ?? VERSIONED.exec(t)?.[1] ?? null },
  { name: "standard", read: (t) => (STANDARD.test(t) ? t : null) },
];

// -> { modern: [version], windows: [version], framework: [version], standard: [name], other: [name] }
export function classified(targets) {
  const out = { modern: [], windows: [], framework: [], standard: [], other: [] };
  for (const t of targets) place(out, t);
  return out;
}

function place(out, target) {
  const hit = CLASSES.map((c) => ({ name: c.name, version: c.read(target) })).find((c) => c.version);
  (hit ? out[hit.name] : out.other).push(hit?.version ?? target);
}

const parts = (v) => String(v).split(".").map(Number);

// Numeric, part by part: 4.7.2 is below 4.8, and 5.0 is below 10.0.
const lower = (a, b) => parts(a).reduce((d, n, i) => d || n - (parts(b)[i] ?? 0), 0) <= 0;

export const lowest = (versions) => versions.reduce((a, b) => (lower(a, b) ? a : b));

// -> { requires, unknowns }
export function requirementsOf(targets) {
  const found = classified(targets);
  return { requires: required(found), unknowns: [...noted(found), ...platformNote(targets)] };
}

// A target that names another platform (`net8.0-android`) is still modern, and only a machine of
// that platform can run it -- which machines those are is not this reader's to settle, so it is
// said. Windows is not among them: a unit whose every modern target names it requires it.
const PLATFORM = /^net\d+\.\d+-([a-z]+)/i;

function platformNote(targets) {
  const named = [...new Set(targets.map((t) => PLATFORM.exec(t)?.[1]?.toLowerCase()).filter((p) => p && p !== "windows"))];
  return named.length ? [`a target names a platform (${named.join(", ")}), so it may run only there — which machines that is is not read`] : [];
}

// A modern target that names no platform runs wherever its runtime does, so it is the one held
// against a machine; only when every modern target names Windows is the unit Windows's alone.
function required(found) {
  if (found.modern.length) return { dotnet: `>=${lowest(found.modern)}` };
  if (found.windows.length) return { "dotnet-windows": `>=${lowest(found.windows)}` };
  if (found.framework.length) return { "dotnet-framework": `>=${lowest(found.framework)}` };
  return {};
}

function noted(found) {
  const both = (found.modern.length || found.windows.length) && found.framework.length ? ["it also targets the classic framework; only its modern target is held against a machine, because that is the one a machine without the classic runtime can run"] : [];
  const standard = found.standard.length && !found.modern.length && !found.windows.length && !found.framework.length ? [`it targets ${found.standard.join(", ")}, a library target: what it needs is whatever consumes it`] : [];
  const other = found.other.length ? [`${found.other.join(", ")} is a target this reader does not recognise, so what it needs is not read`] : [];
  return [...both, ...standard, ...other];
}
