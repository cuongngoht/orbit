// WHICH EXECUTION AN EMPLOYEE'S WORK RUNS ON (Workforce, pure): field by field -- connection, model, effort -- the
// mission's own override, else the employee's profile, else its department's default, else the company's default (a
// connection left to none is the runtime's default connection of the account, as before). The RUNTIME is always the
// employee's own: a default of another runtime never applies, and nothing here switches an employee's provider. A
// profile names the fields it leaves to its department or company (`inherit`); a profile that names none -- every
// profile written before defaults existed -- keeps exactly what it chose. What each field came from is said with it.
import type { ExecutionDefault, ExecutionDefaults, ExecutionLayer, ExecutionProfile, ExecutionSources, InheritableField } from "@orbit-web/contracts";

export interface ExecutionLayers {
  // The mission's (or assignment's) override: model and effort only.
  override: { model?: string; effort?: string | null } | null;
  profile: ExecutionProfile;
  department: ExecutionDefaults | null;
  company: ExecutionDefaults | null;
}

export interface ResolvedExecution {
  execution: ExecutionProfile;
  sources: ExecutionSources;
  // A model no layer gave (a profile that inherits it, with no default set): the caller refuses, saying so.
  unresolved: InheritableField[];
}

const KEY: Record<InheritableField, keyof ExecutionDefault> = { connection: "connectionId", model: "model", effort: "effort" };

// The first layer that says something about `field` for this runtime.
function inherited(field: InheritableField, runtimeDefault: (ExecutionDefault | undefined)[]): { value: string | null | undefined; layer: ExecutionLayer | null } {
  const layers: ExecutionLayer[] = ["department", "company"];
  for (const [i, d] of runtimeDefault.entries()) {
    if (d !== undefined && Object.hasOwn(d, KEY[field])) return { value: d[KEY[field]] as string | null, layer: layers[i] ?? null };
  }
  return { value: undefined, layer: null };
}

export function resolveExecution(l: ExecutionLayers): ResolvedExecution {
  const p = l.profile;
  const inherits = new Set(p.inherit ?? []);
  const defaults = [l.department?.[p.runtime], l.company?.[p.runtime]];
  const sources = { connection: "employee", model: "employee", effort: "employee" } as ExecutionSources;
  const unresolved: InheritableField[] = [];
  const value = { connection: p.connectionId as string | null, model: p.model as string | null, effort: p.effort };
  for (const field of ["connection", "model", "effort"] as const) {
    if (!inherits.has(field)) continue;
    const got = inherited(field, defaults);
    if (got.layer !== null) {
      value[field] = got.value ?? null;
      sources[field] = got.layer;
    } else if (field === "connection") {
      value.connection = null;
      sources.connection = "runtime";
    } else if (field === "effort") {
      value.effort = null;
      sources.effort = "runtime";
    } else unresolved.push(field);
  }
  if (l.override?.model !== undefined) {
    value.model = l.override.model;
    sources.model = "mission";
  }
  if (l.override?.effort !== undefined) {
    value.effort = l.override.effort;
    sources.effort = "mission";
  }
  // What runs is concrete: no field of it is left to anybody any more.
  const execution: ExecutionProfile = { runtime: p.runtime, connectionId: value.connection, model: value.model ?? "", effort: value.effort, webSearch: p.webSearch, orbitPlugin: p.orbitPlugin };
  return { execution, sources, unresolved };
}
