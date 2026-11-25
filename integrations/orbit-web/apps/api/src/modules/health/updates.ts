// WHETHER A NEWER RELEASE EXISTS of what this image holds, as each publisher says it -- npm's registry for the two npm
// CLIs, GitHub's releases for GitHub CLI and the Orbit plugin, PyPI for the Azure CLI, nodejs.org for Node.js (with its
// own word on security releases). Nothing else is asked, and nothing of this installation is sent: a plain GET of a
// public feed. A publisher that cannot be asked is "unknown" with why -- never "up to date"; a component nothing here
// reads is "not checked", saying why.
import { UPDATE_COMPONENTS, type ComponentUpdate, type UpdateComponent } from "@orbit-web/contracts";

// One public feed's JSON (a test hands its own).
export type FetchJson = (url: string) => Promise<unknown>;
export const UPDATE_FEED = Symbol("UPDATE_FEED");

// How this installation takes a newer release -- without waiting for a new Orbit Web (README).
export const HOW_TO_UPDATE = [
  "cd integrations/orbit-web && node scripts/update-pins.mjs --apply",
  "node scripts/build-image.mjs, and the images of the Dockerfile's workstation, model-plane and storage-helper targets",
  "docker compose up -d",
];

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().replace(/^v/, "") : null);

const parts = (v: string): number[] | null => {
  const m = /^v?(\d+(?:\.\d+)*)/.exec(v.trim());
  return m === null ? null : (m[1] as string).split(".").map(Number);
};

// -1, 0 or 1 as `a` is older than, the same as or newer than `b`, part by part as numbers; null when either is no version.
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = parts(a);
  const y = parts(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

interface Newest {
  version: string;
  security: boolean | null;
}

interface Source {
  url: string;
  newest(body: unknown, installed: string): Newest | null;
}

const field =
  (read: (b: Json) => unknown): Source["newest"] =>
  (body) => {
    const v = isRecord(body) ? str(read(body)) : null;
    return v === null ? null : { version: v, security: null };
  };

// nodejs.org lists every release newest first: the newest of this major line, and whether any release since this one
// says it is a security release.
function nodeNewest(body: unknown, installed: string): Newest | null {
  if (!Array.isArray(body)) return null;
  const major = parts(installed)?.[0];
  const line = body.filter((r): r is Json => isRecord(r) && typeof r.version === "string" && parts(r.version)?.[0] === major);
  const newest = str(line[0]?.version);
  if (newest === null) return null;
  const since = line.filter((r) => compareVersions(r.version as string, installed) === 1);
  return { version: newest, security: since.some((r) => r.security === true) };
}

const SOURCES: Partial<Record<UpdateComponent, Source>> = {
  claude: { url: "https://registry.npmjs.org/@anthropic-ai/claude-code/latest", newest: field((b) => b.version) },
  codex: { url: "https://registry.npmjs.org/@openai/codex/latest", newest: field((b) => b.version) },
  gh: { url: "https://api.github.com/repos/cli/cli/releases/latest", newest: field((b) => b.tag_name) },
  az: { url: "https://pypi.org/pypi/azure-cli/json", newest: field((b) => (isRecord(b.info) ? b.info.version : null)) },
  node: { url: "https://nodejs.org/dist/index.json", newest: nodeNewest },
  orbit: { url: "https://api.github.com/repos/cuongngoht/orbit/releases/latest", newest: field((b) => b.tag_name) },
};

const NOT_CHECKED: Partial<Record<UpdateComponent, string>> = {
  agy: "Antigravity publishes no version feed this check reads: its pin moves with Orbit Web's image (scripts/update-pins.mjs prints how).",
  git: "Git comes with the image's base system: it moves when the base image is updated.",
  python: "Python is pinned to a standalone build in the image: it moves with Orbit Web's image.",
};

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function one(component: UpdateComponent, installed: string | null, fetchJson: FetchJson): Promise<ComponentUpdate> {
  const base = { component, installed, latest: null, security: null };
  const why = NOT_CHECKED[component];
  if (why !== undefined) return { ...base, state: "not_checked", detail: why };
  if (installed === null) return { ...base, state: "unknown", detail: "Not in this image." };
  const source = SOURCES[component] as Source;
  let body: unknown;
  try {
    body = await fetchJson(source.url);
  } catch (err) {
    return { ...base, state: "unknown", detail: `Its publisher could not be asked: ${message(err)}`.slice(0, 300) };
  }
  const newest = source.newest(body, installed);
  if (newest === null) return { ...base, state: "unknown", detail: "Its publisher's answer named no version." };
  const order = compareVersions(installed, newest.version);
  if (order === null) return { ...base, latest: newest.version, state: "unknown", detail: `${installed} and ${newest.version} cannot be compared.` };
  return { ...base, latest: newest.version, security: newest.security, state: order === -1 ? "update_available" : "up_to_date", detail: null };
}

// Every component, in order, each from its own publisher (asked together).
export function checkUpdates(installed: Record<UpdateComponent, string | null>, fetchJson: FetchJson): Promise<ComponentUpdate[]> {
  return Promise.all(UPDATE_COMPONENTS.map((c) => one(c, installed[c], fetchJson)));
}

// The feed a deployment asks: a plain GET, a generic name, no credential, ten seconds at most.
export const publicFeed: FetchJson = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "orbit-web-update-check" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as unknown;
};
