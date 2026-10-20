// The memory port, in memory. Same five names as src/memory/index.mjs, nothing
// on disk -- a test that recorded a run into a real machine's store would be a
// test that pollutes the machine it runs on.
//
// It scrubs because the real one does. A fake that skipped the masking would let
// every runner test assert against values the committed ledger never actually
// holds, which is the one way a fake stops being evidence about the real thing.
import { scrubRecord } from "../../src/scrub.mjs";

export function fakeMemory({ runs = [], notes = [] } = {}) {
  const recorded = [...runs];
  const written = [...notes];
  const saveNote = (n) => {
    written.push(n);
    return `<fake>/notes/${n.about}.md`;
  };
  return { root: () => "<fake>", recorded, written, saveNote, evidenceDir: () => "<fake>/evidence", pruned: [], prune(policy) { this.pruned.push(policy); return []; }, recordRun: (r) => recorded.push(scrubRecord(r)), runs: (limit = 500) => recorded.slice(-limit), notes: () => written };
}
