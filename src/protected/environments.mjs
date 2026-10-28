// WHERE AN ACTION LANDS, as something that knows declared it -- never a word guessed from a command line.
//
// Orbit already lets a target be named for what it is: a runtime reach target's `classification` (a person's, in
// src/runtime/settings.mjs), an autonomous-QA environment's `kind` (src/investigation/vocab.mjs), a capability's own
// `environment` (src/capability/contract-v1.mjs). Each is one of a handful of words, and this table reads every one of
// them onto ONE tier, so a protected boundary asks "is it production?" in one place.
//
// A word nobody listed is `unknown`, and unknown is never production: a remote target is not production because it is
// remote, only because something that knows declared it so. Being conservative is about an EXPLICIT production
// declaration -- whichever source says production wins (`strictestTier`).
export const TIERS = Object.freeze([
  { tier: "production", words: ["production"] },
  { tier: "staging", words: ["staging"] },
  { tier: "preview", words: ["preview"] },
  { tier: "development", words: ["development", "shared-development"] },
  { tier: "test", words: ["test"] },
  { tier: "local", words: ["local", "sandbox", "task-isolated"] },
]);

export const UNKNOWN = "unknown";

export const TIER_NAMES = Object.freeze([...TIERS.map((t) => t.tier), UNKNOWN]);

// What a declaration may name: a tier itself.
export const DECLARABLE = Object.freeze(TIERS.map((t) => t.tier));

const wordOf = (word) => String(word ?? "").trim().toLowerCase();

export const tierOf = (word) => TIERS.find((t) => t.words.includes(wordOf(word)))?.tier ?? UNKNOWN;

export const isProduction = (word) => tierOf(word) === "production";

// The strictest of several declarations, read in TIERS order (production first); unknown only when none is known.
export const strictestTier = (words) => ((tiers) => TIERS.find((t) => tiers.includes(t.tier))?.tier ?? UNKNOWN)((words ?? []).map(tierOf));
