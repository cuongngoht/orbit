// Holding a sidecar to its definition (ADR 0031): a PROPOSAL from a host, or an ARTIFACT the
// engine wrote and reads back.
//
// Both are walked by the same rules a plan is (src/walk.mjs). A proposal is held to two more:
// a field only the engine stamps is refused BY NAME -- "sourceAuthority is the engine's to
// stamp" -- never dropped, because a dropped field is a field the sender believes was taken;
// and a definition no host may write at all (a version, an execution, a result) is refused
// whole. A list of refs that grant anything must hold logical aliases only.
import { walkFindings } from "../../walk.mjs";
import { ALIAS, DEFINITIONS } from "./contract.mjs";

export function proposalFindings(kind, record, at = kind) {
  const def = DEFINITIONS[kind];
  if (!def) return [`${at}: "${kind}" is not a sidecar this engine knows`];
  if (def.proposable === false) return [`${at}: a ${kind} is the engine's to write — a host never proposes one`];
  return [...stampedFindings(def, record, at), ...aliasFindings(def, record, at), ...artifactFindings(kind, record, at)];
}

export function artifactFindings(kind, record, at = kind) {
  const def = DEFINITIONS[kind];
  if (!def) return [`${at}: "${kind}" is not a sidecar this engine knows`];
  if (!record || typeof record !== "object" || Array.isArray(record)) return [`${at}: a ${kind} is an object`];
  return walkFindings(DEFINITIONS, def.table, def.required, record, at);
}

const stampedFindings = (def, record, at) => def.stamped.filter((k) => record?.[k] !== undefined).map((k) => `${at}: ${k} is the engine's to stamp — refused, never taken from a proposal`);

const aliasFindings = (def, record, at) => (def.aliases ?? []).flatMap((k) => (Array.isArray(record?.[k]) ? record[k] : []).filter((v) => typeof v !== "string" || !ALIAS.test(v)).map((v) => `${at}: ${k} holds "${String(v).slice(0, 40)}", which is not a logical alias`));
