// The adapters this engine ships, in registration order -- the one place they
// are bound, the way src/run/context.mjs is the one place real ports are.
//
// A registration, never a branch: a caller that needs "the ecosystems this
// engine knows" asks for `builtinEcosystems()` and registers its own after them,
// and nothing below this file ever tests which adapter it is holding.
import { createEcosystemRegistry } from "./registry.mjs";
import { dotnet } from "./dotnet.mjs";
import { node } from "./node.mjs";

export const BUILTIN_ECOSYSTEMS = [node, dotnet];

export const builtinEcosystems = () => createEcosystemRegistry(BUILTIN_ECOSYSTEMS);
