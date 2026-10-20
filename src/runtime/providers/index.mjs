// The providers this engine ships, in the order the resolver prefers them -- the
// one place they are bound, the way src/ecosystems/builtin.mjs is for adapters.
//
// A registration, never a branch: a caller that needs "the ways this engine can
// run things" asks for the list, and nothing below this file tests which provider
// it is holding. Order is preference among providers that are BOTH compatible --
// it never makes an incompatible one compatible. Native comes first because a
// checkout that can run on the machine in front of a person needs no container.
import { Refused } from "../../errors.mjs";
import { providerProblems } from "./contract-v1.mjs";
import { devcontainer } from "./devcontainer.mjs";
import { native } from "./native.mjs";
import { sandbox } from "./sandbox.mjs";

export const PROVIDERS = [native, devcontainer];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

// What a SANDBOX's context is bound to: the two ways a component runs, which the sandbox provider places each
// component on, and the sandbox provider itself. It is a separate list because a person's runtime never asks it:
// a sandbox runs only a task's workspace.
export const SANDBOX_PROVIDERS = [...PROVIDERS, sandbox];

// Refuses a malformed provider the way the capability and ecosystem registries do:
// a sentence, never a TypeError three layers up.
export function boundProviders(list = PROVIDERS) {
  const bad = list.flatMap(providerProblems);
  if (bad.length) throw new Refused(`cannot bind the runtime providers — ${bad.join("; ")}`);
  return list;
}

export const providerOf = (id, list = PROVIDERS) => list.find((p) => p.id === id) ?? null;
