// The RELATION ADAPTERS a task's files are followed with (0.6.0, U3), in the order they are asked: the first that
// detects a path reads it. The walk is src/context/relations.mjs, which names no language; what a file imports, how a
// name resolves and which tests go with it are each adapter's, here. cli/context-grounding.mjs binds this list and
// hands it in. Adding one is a file here with the contract (id, detects, specifiersOf, resolve, testsOf,
// importersPattern) and a row below; docs/agents/extend.md says what to test.
import { JAVASCRIPT } from "./javascript.mjs";
import { PYTHON } from "./python.mjs";

export const RELATION_ADAPTERS = Object.freeze([JAVASCRIPT, PYTHON]);
