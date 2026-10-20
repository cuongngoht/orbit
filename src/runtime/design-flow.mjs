// From what is understood to a proposal, and from a proposal to whether it is still
// true -- the glue the `design` and `adopt` commands share, so the two cannot
// fingerprint a checkout two ways.
//
// A proposal rests on the runtime understanding (a digest over its facts and what
// read them) and on every environment file the designer considered or would write.
// `proposalFor` records both at the moment of design; `currentOf` measures both again
// at the moment of adoption, over the SAME set of files plus any definition that has
// appeared since -- a `devcontainer.json` that somebody created while a proposal for
// "no definition" was being read is a change, and is found.
import { inspect } from "./environment/devcontainer.mjs";
import { design } from "./design/designer.mjs";
import { build, fingerprintOf, understandingDigest } from "./proposal.mjs";
import { requirementsOf } from "./requirements.mjs";

export function designed(ctx, understanding) {
  const requirements = withProbePorts(requirementsOf(understanding.view, ctx.catalog), ctx.readSettings?.().settings);
  return design({ requirements, inspected: inspect(ctx.tree), catalog: ctx.catalog, name: ctx.name });
}

// A port a person said a component answers on is one to publish too: a checkout whose own files name
// no port is otherwise unreachable in its container, however well it runs there.
function withProbePorts(requirements, settings) {
  const said = Object.values(settings?.components ?? {}).map((c) => probePort(c?.readiness)).filter(Number.isInteger);
  return { ...requirements, ports: [...new Set([...requirements.ports, ...said])].sort((a, b) => a - b) };
}

function probePort(readiness) {
  if (readiness?.kind === "tcp") return readiness.target;
  return readiness?.kind === "http" ? urlPort(readiness.target) : null;
}

function urlPort(target) {
  try {
    const url = new URL(target);
    return Number(url.port || (url.protocol === "https:" ? 443 : 80));
  } catch {
    return null;
  }
}

const digestOf = (understanding) => understandingDigest(understanding.facts, understanding.model?.readers ?? null);

const fingerprints = (ctx, paths) => Object.fromEntries([...new Set(paths)].sort().map((p) => [p, fingerprintOf(ctx.tree.read(p))]));

const definitionPaths = (ctx) => inspect(ctx.tree).definitions.map((d) => d.path);

export function proposalFor(ctx, understanding, body) {
  const touched = [...body.files.create.map((f) => f.path), ...body.files.patch.map((f) => f.path)];
  return build(body, { checkout: ctx.checkout, understanding: digestOf(understanding), environment: fingerprints(ctx, [...definitionPaths(ctx), ...touched]), now: ctx.now() });
}

// What is true NOW, in the form `freshness` compares: the understanding's digest, and
// the fingerprint of every file the proposal recorded or that is a definition today.
export function currentOf(ctx, proposal, understanding) {
  return { understanding: digestOf(understanding), environment: fingerprints(ctx, [...Object.keys(proposal.environment), ...definitionPaths(ctx)]) };
}
