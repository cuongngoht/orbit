// Thin CLI boundary for commands that can refuse a destination before writing.
import { Blocked, Refused } from "../errors.mjs";
import { printable } from "../printable.mjs";

// Handles a synchronous main and an async one alike. Loading a project's own
// extensions is the one async thing this engine does (importing a module is),
// and an entry point that awaits it must still turn a Refused into exit 2 --
// which a bare try/catch around a promise would silently stop doing.
export function command(main) {
  try { return settled(main()); }
  catch (e) { return stopped(e); }
}

const settled = (result) => (result && typeof result.then === "function" ? result.catch(stopped) : result);

function stopped(error) {
  if (!(error instanceof Refused) && !(error instanceof Blocked)) throw error;
  console.error(printable(error.message));
  process.exitCode = error instanceof Refused ? 2 : 3;
}
