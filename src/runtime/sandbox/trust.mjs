// A PERSON'S REVIEW MARK on exactly what a task's sandbox runs -- evidence, never a gate (0.2.0).
//
// A task's own sandbox is AUTONOMOUS: it restores its dependencies, builds its dev container and brings its isolated
// topology up without anybody (src/runtime/sandbox/prepare.mjs). What it ran is kept by FINGERPRINT -- the whole
// SHA-256 of exactly what would run, so an edited lock file or definition is a different print -- and a person may mark
// a fingerprint as reviewed here; the sandbox's receipts then say so. Nothing waits on a mark, and none is a
// permission: the protected boundaries are src/protected/'s.
//
// A mark is still a person's: a terminal cannot prove who typed `--human`, so only Orbit Control -- after its mutation
// token -- sets `door: "control"` on the context, and a mark goes through the same revisioned door as every setting.
import { Refused } from "../../errors.mjs";
import { canonicalJson, sha } from "../../hash.mjs";
import { FINGERPRINT, MAX_TRUSTED, sandboxFilled, trustKind } from "./policy.mjs";

// What a dev container definition IS, as evidence: the fingerprint of every file it is built from. Any change to one
// is a different fingerprint.
export const definitionFingerprint = (files) => (Object.keys(files ?? {}).length ? sha(canonicalJson(files)) : null);

// The ordered reasons a trust is refused BEFORE anything is read or written.
const GRANT = [
  { fails: (ctx) => ctx.door !== "control", says: "trusting is a person's, and a terminal cannot prove one: do it in Orbit Control (Runtime → Sandbox policy)" },
  { fails: (ctx, w) => !trustKind(w.kind), says: (ctx, w) => `there is no kind of trust ${JSON.stringify(w.kind)}` },
  { fails: (ctx, w) => !FINGERPRINT.test(String(w.fingerprint)), says: "a fingerprint is the 64 lowercase hex digits of a SHA-256, as the sandbox said it" },
  { fails: (ctx, w) => w.revision !== null && typeof w.revision !== "string", says: "name the revision of the settings you read, or null when none was ever saved" },
];

const saidOf = (row, ctx, w) => (typeof row.says === "function" ? row.says(ctx, w) : row.says);

// -> the kept settings. `w` is { kind, fingerprint, revoke, revision }.
export function trust(ctx, w) {
  const refused = GRANT.find((r) => r.fails(ctx, w));
  if (refused) throw new Refused(saidOf(refused, ctx, w));
  const kind = trustKind(w.kind);
  const current = ctx.readSettings();
  return ctx.writeSettings({ next: { ...current.settings, sandbox: changed(sandboxFilled(current.settings.sandbox), kind, w) }, revision: w.revision, by: "person" });
}

function changed(policy, kind, w) {
  const list = kind.read(policy).filter((f) => f !== w.fingerprint);
  if (w.revoke) return kind.write(policy, list);
  if (list.length >= MAX_TRUSTED) throw new Refused(`up to ${MAX_TRUSTED} ${kind.say}s may be trusted: revoke one first`);
  return kind.write(policy, [...list, w.fingerprint]);
}
