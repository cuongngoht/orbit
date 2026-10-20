// WHAT A PERSON MAY TRUST, and the one door a trust goes through.
//
// Trust is a standing permission, so it is stronger than a one-shot approval and it is held to the same rule as
// every grant since 1.7.7: a terminal cannot prove who typed `--human`, so only Orbit Control -- after its
// mutation token -- sets `door: "control"` on the context. The CLI documents the command and refuses it.
//
// A trust is a FINGERPRINT in the person's settings (src/runtime/sandbox/policy.mjs TRUST_KINDS), written
// through the same revisioned door as every other setting, so a page that read an old revision is refused and
// a trust can never overwrite what somebody else just changed.
import { Refused } from "../../errors.mjs";
import { canonicalJson, sha } from "../../hash.mjs";
import { FINGERPRINT, MAX_TRUSTED, sandboxFilled, trustKind } from "./policy.mjs";

// What a dev container definition is trusted AS: the fingerprint of every file it is built from. Any change to
// one is a different fingerprint, so a trusted definition that is edited asks again.
export const definitionFingerprint = (files) => (Object.keys(files ?? {}).length ? sha(canonicalJson(files)) : null);

// Ordered; the last always matches.
export const DEFINITION_TRUST = [
  { name: "NO_DEFINITION", when: (c) => c.fingerprint === null, trusted: true, needs: null, say: () => "there is no dev container definition to trust" },
  { name: "TRUSTED", when: (c) => c.policy.trustedDefinitions.includes(c.fingerprint), trusted: true, needs: null, say: (c) => `the dev container definition is trusted at fingerprint ${c.fingerprint}` },
  { name: "UNTRUSTED", when: () => true, trusted: false, needs: "person", say: (c) => `the dev container definition (fingerprint ${c.fingerprint}) is not trusted for autonomous use on this machine: bringing it up runs commands its own definition names, on the host. A person trusts it in Orbit Control (Runtime → Sandbox policy)` },
];

export const definitionTrust = (c) => DEFINITION_TRUST.find((r) => r.when(c));

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
