// What the tests of ONE investigation share (0.4.0): the sandbox every one of them runs in, and so its state. Nothing
// resets it between two tests, so an effect a test left, a key it used and an occurrence it made due are there when the
// next one runs -- and a test that names one of them again finds what the earlier one left: a first message that is
// already a duplicate, an effect it did not make, a period its schedule already decided. A real host's tests did just
// that: one published under the business key of a period its schedule would reach, the next made the schedule reach
// that period and waited for its message to be processed -- and the clean application settled it as the duplicate it was.
//
// So a host is told before it designs (ONE_SANDBOX: every test obligation's template and protocol.design print it), and
// told after a design when the journal shows it (`sharedWith`): a literal the design names under a word of the backend
// vocabulary that says WHICH business operation, message or period a value is (KEY_WORDS) that an earlier frozen version
// of the same investigation named too. That is advice, never a refusal: a test may observe on purpose what an earlier one
// left -- the period a schedule already decided -- and nothing here can tell which. A value a binding fills (`${…}`) is
// no literal: the run's own namespace keeps it apart.
import { requestOf, stepsOf } from "./skeleton.mjs";

export const ONE_SANDBOX = "the tests of one investigation run one after another in the same sandbox and share its state: an effect, a key or a scheduled occurrence a test used stays there for the next test. So a design uses business keys, message ids and occurrences no earlier test of this investigation used, none an accepted criterion states for another test, and none a schedule will produce on its own once its clock reaches them, unless that is what the test observes";

// The words of the backend vocabulary (bindings.mjs MESSAGE_FIELDS, SCHEDULE_FIELDS) whose value names ONE business
// operation, message or period -- never how it went, and never a routing key many messages share.
export const KEY_WORDS = ["businessKey", "correlationId", "messageId", "occurrenceId"];

// How deep a request is walked for them: its own top, its match, the payload it publishes and what that holds.
const DEPTH = 6;

const literal = (v) => typeof v === "string" && v.length > 0 && !v.includes("${");

// Every [value, word] a request names under one of those words, anywhere in it.
const namedIn = (node, depth) => (depth > DEPTH || typeof node !== "object" || node === null ? [] : Object.entries(node).flatMap(([k, v]) => (KEY_WORDS.includes(k) && literal(v) ? [[v, k]] : namedIn(v, depth + 1))));

// Every literal a design's steps name under one of those words, as value → the words it was named by.
export const keysOf = (design) => stepsOf(design).flatMap((s) => namedIn(requestOf(s), 0)).reduce((keys, [value, word]) => keys.set(value, [...new Set([...(keys.get(value) ?? []), word])]), new Map());

// What a design names that each earlier version of its investigation named too. `earlier`: [{ version, obligation,
// shape, design }], oldest first -> [{ version, obligation, shape, keys: [{ value, as }], say }]; no design is echoed.
export const sharedWith = (design, earlier) => ((mine) => earlier.map((e) => [e, common(mine, keysOf(e.design))]).filter(([, keys]) => keys.length).map(([e, keys]) => sharedOne(e, keys)))(keysOf(design));

const common = (mine, theirs) => [...mine].filter(([value]) => theirs.has(value)).map(([value, as]) => ({ value, as }));

const AFTER = "both run in its one sandbox, and whichever runs later finds what the other left there — use one no earlier test used, unless what is already there is what this test observes";

const sharedOne = (e, keys) => ({ version: e.version, obligation: e.obligation, shape: e.shape ?? null, keys, say: `${keys.map((k) => `${k.as.join("/")} ${k.value}`).join(", ")} — named by ${e.version} (${e.shape ?? e.obligation}) of this investigation too: ${AFTER}` });
