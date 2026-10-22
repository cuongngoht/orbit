// Security catalogs as control-server answers them, in memory. Like the real server, every change
// names the revision it read and a stale one is a 409, an adopt must name the digest the preview
// showed, and a mark needs its reason.
import type { CatalogListed, Enabled, Mark, SecurityOverview } from "../features/security/security.types";
import { reply, type Call } from "./fakeServer";

const SHIPPED: CatalogListed = { catalog: "asvs-5.0.0-l1", version: "5.0.0", title: "OWASP ASVS 5.0.0 — Level 1, a checked selection", digest: "a".repeat(64), controls: 12, default: true };
const POLICY_DIGEST = "b".repeat(64);

interface Body {
  revision?: string | null;
  url?: string;
  text?: string;
  digest?: string;
  enabled?: Enabled[];
  catalog?: string;
  control?: string;
  why?: string;
  clear?: boolean;
}

const bodyOf = (call: Call): Body => (typeof call.body === "object" && call.body !== null ? (call.body as Body) : {});

export function fakeSecurity() {
  const state = { adopted: [] as CatalogListed[], enabled: [] as Enabled[], marks: [] as Mark[], index: null as string | null, project: null as string | null, n: 0, fetched: [] as string[] };
  const effective = () => (state.enabled.length ? { by: "project" as const, catalogs: state.enabled.map((e) => ({ catalog: e.catalog, version: "1", digest: e.digest, layer: "adopted", filter: null, controls: 2 })), missing: [] } : { by: "default" as const, catalogs: [{ catalog: SHIPPED.catalog, version: SHIPPED.version, digest: SHIPPED.digest, layer: "shipped", filter: null, controls: SHIPPED.controls }], missing: [] });
  const overview = (): SecurityOverview => ({ available: true, checkout: { name: "portal" }, shipped: [SHIPPED], adopted: state.adopted, refused: [], index: { revision: state.index, unreadable: null }, project: { available: true, revision: state.project, enabled: state.enabled, notApplicable: state.marks, effective: effective() } });
  const stale = (seen: string | null | undefined, now: string | null) => seen !== now;
  const conflictReply = () => reply(409, { error: { code: "STALE_REVISION", message: "These security settings were changed since you opened them. Reload, then make your change again." } });

  const preview = (b: Body) => {
    if (b.url) state.fetched.push(b.url);
    return reply(200, { preview: { ok: true, problems: [], catalog: "acme-policy", version: "1", title: "The team's own policy", digest: POLICY_DIGEST, controls: 2, against: null, same: false, diff: { added: ["acme-1", "acme-2"], removed: [], changed: [] } }, source: { kind: b.url ? "url" : "file" } });
  };

  const adopt = (b: Body) => {
    if (b.digest !== POLICY_DIGEST) return reply(409, { error: { code: "SECURITY_PREVIEW_STALE", message: "this catalog is not the one you previewed" } });
    if (stale(b.revision, state.index)) return conflictReply();
    state.adopted = [...state.adopted, { catalog: "acme-policy", version: "1", title: "The team's own policy", digest: POLICY_DIGEST, controls: 2 }];
    state.index = `idx-${++state.n}`;
    return reply(200, { adopted: { adopted: state.adopted, revision: state.index } });
  };

  const enable = (b: Body) => {
    if (stale(b.revision, state.project)) return conflictReply();
    state.enabled = b.enabled ?? [];
    state.project = `prj-${++state.n}`;
    return reply(200, { saved: { settings: { enabled: state.enabled, notApplicable: state.marks }, revision: state.project } });
  };

  const mark = (b: Body) => {
    if (!b.clear && !b.why?.trim()) return reply(400, { error: { code: "SECURITY_CATALOG_INVALID", message: "why is the reason it does not apply here" } });
    if (stale(b.revision, state.project)) return conflictReply();
    state.marks = b.clear ? state.marks.filter((m) => m.control !== b.control) : [...state.marks, { catalog: b.catalog ?? "", control: b.control ?? "", why: b.why ?? "", at: null }];
    state.project = `prj-${++state.n}`;
    return reply(200, { saved: { settings: { enabled: state.enabled, notApplicable: state.marks }, revision: state.project } });
  };

  const ROUTES: [string, string, (b: Body) => Response][] = [
    ["POST", "/api/v1/security/catalogs/preview", preview],
    ["POST", "/api/v1/security/catalogs/adopt", adopt],
    ["PUT", "/api/v1/security/project/enabled", enable],
    ["PUT", "/api/v1/security/project/not-applicable", mark],
  ];

  const handle = (call: Call): Response | null => {
    if (!call.path.startsWith("/api/v1/security")) return null;
    if (call.path === "/api/v1/security/catalogs" && call.method === "GET") return reply(200, overview());
    const route = ROUTES.find(([m, p]) => m === call.method && p === call.path);
    if (route) return route[2](bodyOf(call));
    if (call.path.startsWith("/api/v1/security/catalogs/") && call.method === "GET") return reply(200, { catalog: SHIPPED.catalog, version: SHIPPED.version, digest: SHIPPED.digest, layer: "shipped", document: { controls: [{ id: "v5.0.0-8.1.1", summary: "rules written down" }, { id: "v5.0.0-8.2.1", summary: "function-level access" }] } });
    return reply(404, { error: { code: "NOT_FOUND", message: `no endpoint at ${call.path}` } });
  };

  return { handle, state };
}
