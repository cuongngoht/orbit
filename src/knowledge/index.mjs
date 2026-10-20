// The command table -- every other memory's shape. `writes` is a COLUMN so the
// test proving no knowledge command touches the repository it reads iterates
// the table, and `needs` is what the composition root must bind for it:
//
//   store        the knowledge room, and nothing else
//   vocabulary   the room, the source tree, the project's extensions loaded,
//                and the relation vocabulary offered layer by layer
//   resources    all of that, plus the resource registry and the cases -- what
//                deciding "who can prove this" needs
import { claims, why } from "./views/claims.mjs";
import { record } from "./views/record.mjs";
import { decide, opportunities, verify } from "./views/verify.mjs";
import { vocabulary, where } from "./views/vocabulary.mjs";

export const COMMANDS = {
  claims: { run: claims, writes: "nothing", needs: "vocabulary" },
  why: { run: why, writes: "nothing", needs: "vocabulary" },
  record: { run: record, writes: "store", needs: "vocabulary" },
  vocabulary: { run: vocabulary, writes: "nothing", needs: "vocabulary" },
  verify: { run: verify, writes: "store", needs: "resources" },
  opportunities: { run: opportunities, writes: "nothing", needs: "store" },
  decide: { run: decide, writes: "store", needs: "store" },
  where: { run: where, writes: "nothing", needs: "store" },
};

export const COMMAND_NAMES = Object.keys(COMMANDS);

export const runKnowledge = (ctx, cmd, args) => COMMANDS[cmd].run(ctx, args);
