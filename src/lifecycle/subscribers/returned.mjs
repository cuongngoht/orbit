// AFTER ONE OF ORBIT'S AGENTS RETURNS (0.5.0, B22 M3, ADR 0050): one line for the parent session, beside the Agent
// call's result -- which owner record settles that agent's work, and where it stands. What the agent said is its
// REPORT, never the evidence: a workflow's step is settled on its owner's record (`automation settle`), a Satellite run
// on the report it hands its mission, anything else by its owner's own read.
//
// Only an Agent call to an agent of THIS plugin (`<plugin>:<agent>`), and only while the session holds governed work:
// the mission an Orbit envelope named, else this session's own workflow, goal, tracked work or engineering task, through
// the association table and the work's own links (cli/governed.mjs). Anything else answers nothing. The agent's message,
// its transcript and every field of the call's result but the one id the adapter already reads are never read (ADR
// 0044): this line is built from the owner's table words and ids alone (src/lifecycle/owners.mjs).
//
// Claude Code puts it beside the result only from a SYNCHRONOUS PostToolUse hook matched to `Agent`; whether that hook
// fires when an Agent call returns is for the activation suite's first real run to confirm.
import { returnLine } from "../owners.mjs";

// One of this plugin's agents, by the namespace the host calls it by -- never a bare name another plugin could share.
export const oursOf = (event, plugin) => event.invokes?.kind === "agent" && String(event.invokes.name ?? "").startsWith(`${plugin ?? "orbit"}:`);

export const returned = {
  name: "returned",
  on: ["post-tool"],
  records: false,
  run: (event, world) => (oursOf(event, world.plugin) ? said(event, world, world.governedFor?.(event) ?? null) : null),
};

const said = (event, world, owner) => (owner ? world.host.formatPostTool?.(returnLine(event.invokes.name, owner, world.engine, event.background === true), world.input) ?? null : null);

// Whether a post-tool event reaches the owners' records: what lets the composition root load them for one of its agents
// alone, and answer every other tool at once.
export const needsOwners = (event, world) => oursOf(event, world.plugin);
