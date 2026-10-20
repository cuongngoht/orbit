// Is this server up, on what, and how many skills can it see. No path, no
// token, no environment -- nothing a page could not already have worked out.
import { listSkills } from "./skills/catalog.mjs";

export const health = (ctx) => ({ status: "ok", node: ctx.node, engine: ctx.engine, skills: listSkills(ctx).length });
