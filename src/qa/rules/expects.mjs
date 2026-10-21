// A criterion's STRUCTURED expectations, held to what the engine can compile (ADR 0031).
//
// `expects` is the part of a criterion an assertion can be MAPPED to without anybody's
// judgement, so it has to name a meaning the engine knows (src/topology/vocab.mjs) -- never a
// provider's field -- and an absence or a completion has to say the window it is claimed
// within. A window nobody stated is not filled in here: a deadline that is not in an accepted
// source is how a test gets tuned until it goes green.
import { meaningAt } from "../../topology/vocab.mjs";
import { error } from "../finding.mjs";
import { EXPECT_OP } from "../vocab.mjs";
import { at, criteriaOf, members } from "./common.mjs";

export const expectsFindings = (p) => criteriaOf(p).flatMap((c) => members(c, "expects").flatMap((e) => oneExpect(p, c, e)));

const oneExpect = (p, c, e) => [...meaningFindings(p, c, e), ...windowFindings(p, c, e)];

const meaningFindings = (p, c, e) => (typeof e.property !== "string" || meaningAt(e.property) ? [] : [error(at(p, c), `expectation ${e.id ?? "?"} is about "${e.property}", which is no meaning this engine knows — name what is observed (response.status, effect.count, message.id …), never a provider's own field`)]);

const windowFindings = (p, c, e) => (EXPECT_OP.get(e.op)?.window && e.within === undefined ? [error(at(p, c), `expectation ${e.id ?? "?"} claims ${e.op} with no window — an absence or a completion is only ever claimed within one, and the window comes from the source, never from here`)] : []);
