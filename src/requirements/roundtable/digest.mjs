// WHICH STATE of a requirement a round reviewed: a digest of what a clarification may turn on, and
// nothing about when, by whom or in which order it came to be.
//
// It is the snapshot's own account of the standing facts (id, revision, status and the digest of what
// each says and rests on) and of the decisions, plus where each question stands -- the three things
// that change what is still worth asking. It leaves out time, session, history, who a question was
// put to, the model and the order anything was read in, so the same requirement state is the same
// digest on any machine, and a person's answer is the one thing that can make it another.
import { digestOf, decisionsOf, factEntry, standingFacts } from "../snapshot.mjs";

const byId = (a, b) => a.id.localeCompare(b.id);

const standing = (q) => ({ id: q.id, state: q.state });

export function roundContent(port, root) {
  const facts = standingFacts(port);
  return { root, facts: facts.map(factEntry), decisions: decisionsOf(facts), questions: port.questions().map(standing).sort(byId) };
}

// Sixteen characters is a name a person can read in a board and a journal line; the guarantee is the
// same hash every other digest here is.
export const roundDigest = (port, root) => digestOf(roundContent(port, root)).slice(0, 16);
