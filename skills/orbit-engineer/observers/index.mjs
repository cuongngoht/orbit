// The ADAPTERS an observed check is read with (1.8.5, ADR 0020), in the order they are tried: one that CLAIMS the
// declared command by its argument list reads it from the start (a stack's own runner, here, never in src/); else the
// first whose own first line appears in the output (a protocol, src/); else the command's lifecycle only.
//
//   ADAPTERS                       bound by cli/autonomous-engineering.mjs into the check runner's observer
//   CAPABILITY_MATRIX              what each can show, as data: the table README §4.15 prints, which a test holds to
//                                  these rows -- and an observation never claims more than its adapter's row
//
// Adding one is a file here with the adapter contract (id, framework, runner, capabilities, observes, verified,
// claims, sniff, parser) and a row below; docs/agents/extend.md says what to test. It reads; it never adds an
// argument, a variable or a reporter to a command.
import { GENERIC } from "../../../src/orchestration/activity/generic.mjs";
import { TAP } from "../../../src/orchestration/activity/tap.mjs";
import { DOTNET_TEST } from "./dotnet-test.mjs";

export const ADAPTERS = Object.freeze([DOTNET_TEST, TAP, GENERIC]);

export const CAPABILITY_MATRIX = Object.freeze(ADAPTERS.map((a) => ({ id: a.id, framework: a.framework, ...a.capabilities, observes: a.observes, verified: a.verified ?? [] })));
