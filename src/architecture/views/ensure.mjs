// `architecture ensure`: decide, say why, and do only that much.
//
// The one command every other playbook should call. Whether it scans, and how
// much, is the decision table's answer -- a caller asking for architecture
// context must not have to work out for itself whether the snapshot is good
// enough, because that is the judgement this whole feature exists to make once
// and keep.
//
// It prints the DECISION NAME first, always. The same argument
// src/project/repository.mjs makes about `considered`: a tool that decides silently
// cannot be audited, and this one decides whether to spend a second of somebody's
// time reading a repository.
import { Blocked } from "../../errors.mjs";
import { capabilitiesOf } from "../../qa/capability.mjs";
import { decide } from "../ensure.mjs";
import { ensureFacts } from "../facts.mjs";
import { layerFacts, look } from "../capability.mjs";
import { CONFIG_FILE } from "../../project/config.mjs";
import { basename } from "node:path";
import { out } from "../../query/format.mjs";
import { scan, scopesInto, stampAll } from "../scan.mjs";
import { CONFIG_SCOPE } from "../source.mjs";

export function ensure(ctx, args = []) {
  const facts = ensureFacts(ctx, args);
  const decision = decide(facts, { dry: args.includes("--dry") });
  out(`ARCHITECTURE ${decision.name}\n`);
  out(`  ${decision.say}\n`);
  return carried(ctx, facts, decision, args);
}

function carried(ctx, facts, decision, args) {
  if (decision.stops) throw new Blocked(decision.say);
  known(ctx, facts, decision);
  if (decision.scan === "none") return void out("\nscan:\n  skipped — the snapshot answers this");
  performed(ctx, facts, decision, args);
}

// What is already known that bears on the question, before any scanning. This is
// the answer in the common case, and it is printed first for that reason.
function known(ctx, facts, decision) {
  const relevant = facts.facts.filter((f) => f.kind === "capability").slice(0, 8);
  if (!relevant.length) return;
  out("relevant knowledge:");
  for (const f of relevant) out(`  ${marked(f)}${f.statement}`);
}

// A fact nobody checked against the code is MARKED, never hidden -- the habit
// src/learn/recall.mjs keeps for a stale lesson, for the same reason.
const marked = (f) => (f.source === "claude-memory" || f.source === "human-declared-memory" ? "[unverified] " : "");

function performed(ctx, facts, decision, args) {
  const opts = { scopes: facts.moved, layerTools: capabilitiesOf(ctx.config) };
  const done = scan(ctx, decision, opts);
  const extra = capabilityFacts(ctx, facts, done, opts);
  reported(decision, done, extra.facts);
  written(ctx, decision, folded(done, extra), extra.facts, args);
}

// A capability fact's scopes have to reach the state file too, or the next call
// finds a scope nothing recorded, calls it unknown, and rescans forever. That
// was a real bug: asking the same capability question twice scanned twice.
const folded = (done, extra) => ({ ...done, scopes: { ...done.scopes, ...extra.scopes } });

// The capability question is answered from the same listing the scan just read,
// so asking it costs nothing extra -- and a `layer:` fact per verification layer
// goes in beside it, because "can this project rule on sql" is a capability
// question with an answer the config already holds.
function capabilityFacts(ctx, facts, done, opts) {
  const asked = refreshedTokens(facts);
  if (!asked.length) return { facts: [], scopes: {} };
  const input = { files: ctx.source.files() ?? [], read: (p) => ctx.source.read(p), config: ctx.config, facts: done.facts, configPath: ctx.project.layout === 3 ? CONFIG_SCOPE : undefined };
  const raw = [...look(asked, input).facts, ...layerFacts(opts.layerTools, configPath(ctx, input.files))];
  return stampAll(raw, ctx.source, ctx.now);
}

function refreshedTokens(facts) {
  if (!facts.moved.includes(CONFIG_SCOPE)) return facts.asked;
  return [...new Set([...facts.asked, ...facts.facts.filter((f) => f.kind === "capability" && !f.key.startsWith("layer:")).map((f) => f.key)])];
}

// FOUND in the listing rather than computed with `relative`. The port speaks
// repo-root-relative paths, and a scan root that is a subdirectory of the
// checkout makes those two different strings -- a scope that then fingerprints
// to nothing, reads as unknown, and rescans on every call. Whatever the listing
// calls this file is what the listing can be asked about.
function configPath(ctx, files) {
  if (ctx.project.layout === 3) return CONFIG_SCOPE;
  const tail = `${basename(ctx.project.uiTests)}/${CONFIG_FILE}`;
  return files.find((f) => f === tail || f.endsWith(`/${tail}`)) ?? tail;
}

function reported(decision, done, extra) {
  out(`\nscan:\n  ${done.analysers.join(", ") || "nothing"} · ${done.facts.length + extra.length} fact(s)`);
  for (const f of extra) out(`  ${f.confidence.padEnd(8)} ${f.statement}`);
  if (decision.skipped.length) out(`  skipped: ${decision.skipped.join(", ")} moved and ${decision.skipped.length === 1 ? "was" : "were"} not re-read`);
  for (const u of done.unknowns.slice(0, 6)) out(`  could not tell: ${u}`);
}

function written(ctx, decision, done, extra, args) {
  if (!decision.writes) return void out(`\n--dry: ${done.facts.length + extra.length} fact(s) would be recorded — nothing written`);
  saved(ctx, [...done.facts, ...extra]);
  stateInto(ctx, done);
  out(`\n${done.facts.length + extra.length} fact(s) recorded · \`architecture facts\` lists them`);
}

const saved = (ctx, facts) => facts.forEach((f) => ctx.arch.save(f));

function stateInto(ctx, done) {
  const was = ctx.arch.model().model ?? ctx.arch.emptyModel(ctx.now?.() ?? new Date().toISOString());
  ctx.arch.setModel({ ...was, at: ctx.now?.() ?? new Date().toISOString(), commit: ctx.source.commit(), scopes: scopesInto(was.scopes ?? {}, done.scopes) });
}
