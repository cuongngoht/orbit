// REPOSITORY URL MENTIONS IN A MISSION BRIEF: extracts GitHub and Azure DevOps repository references from free text
// (the mission goal) and diagnoses which prerequisite is missing when a mentioned repository is not attached to the
// mission -- keeping access grants, mission attachment, and availability to delegated employees strictly separate.
// Never attaches a repository or grants access automatically.
import type { AccessConnector, EmployeeAccess, MissionRepositoryRequest, RepositoryList, SourcesStatus } from "@orbit-web/contracts";

export interface MentionedRepository {
  source: AccessConnector;
  fullName: string;
  url: string;
}

export interface OfferedRepository {
  source: AccessConnector;
  id: string;
  fullName: string;
}

export type MentionedRepositoryDiagnosis =
  | { kind: "ready_to_attach"; mention: MentionedRepository; repo: OfferedRepository; delegating: boolean }
  | { kind: "connector_disconnected"; mention: MentionedRepository; delegating: boolean }
  | { kind: "missing_access_grant"; mention: MentionedRepository; connectorEnabled: boolean }
  | { kind: "not_listed"; mention: MentionedRepository; delegating: boolean }
  | { kind: "unknown_availability"; mention: MentionedRepository; delegating: boolean };

const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}>'"`]+$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

// Non-repository top-level namespaces on github.com that should never trigger a repository warning.
const GITHUB_RESERVED = new Set([
  "about",
  "apps",
  "codespaces",
  "collections",
  "copilot",
  "customer-stories",
  "enterprise",
  "events",
  "explore",
  "features",
  "gist",
  "issues",
  "join",
  "login",
  "logout",
  "marketplace",
  "new",
  "notifications",
  "organizations",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "signup",
  "site",
  "sponsors",
  "topics",
  "trending",
  "users",
]);

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function stripGitSuffix(name: string): string {
  return name.endsWith(".git") && name.length > 4 ? name.slice(0, -4) : name;
}

function parseRepoUrl(rawUrl: string): MentionedRepository | null {
  const cleaned = rawUrl.replace(TRAILING_PUNCT, "");
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const segments = parsed.pathname
    .split("/")
    .filter((s) => s.length > 0)
    .map(safeDecode);

  if (host === "github.com" || host === "www.github.com") {
    if (segments.length < 2) return null;
    const owner = segments[0] ?? "";
    const repo = stripGitSuffix(segments[1] ?? "");
    if (owner === "" || repo === "" || GITHUB_RESERVED.has(owner.toLowerCase())) return null;
    if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
    return { source: "github", fullName: `${owner}/${repo}`, url: cleaned };
  }

  if (host === "dev.azure.com") {
    // https://dev.azure.com/<org>/<project>/_git/<repo>
    if (segments.length >= 4 && segments[2] === "_git") {
      const org = segments[0] ?? "";
      const project = segments[1] ?? "";
      const repo = stripGitSuffix(segments[3] ?? "");
      if (org !== "" && project !== "" && repo !== "") return { source: "azure", fullName: `${org}/${project}/${repo}`, url: cleaned };
    }
    // https://dev.azure.com/<org>/_git/<repo> (Azure DevOps shorthand when project == repo)
    if (segments.length >= 3 && segments[1] === "_git") {
      const org = segments[0] ?? "";
      const repo = stripGitSuffix(segments[2] ?? "");
      if (org !== "" && repo !== "") return { source: "azure", fullName: `${org}/${repo}/${repo}`, url: cleaned };
    }
    return null;
  }

  if (host.endsWith(".visualstudio.com") && host.length > ".visualstudio.com".length) {
    const org = host.slice(0, -".visualstudio.com".length);
    if (org === "" || org.includes(".")) return null;
    const rest = segments[0]?.toLowerCase() === "defaultcollection" ? segments.slice(1) : segments;
    if (rest.length >= 3 && rest[1] === "_git") {
      const project = rest[0] ?? "";
      const repo = stripGitSuffix(rest[2] ?? "");
      if (project !== "" && repo !== "") return { source: "azure", fullName: `${org}/${project}/${repo}`, url: cleaned };
    }
    if (rest.length >= 2 && rest[0] === "_git") {
      const repo = stripGitSuffix(rest[1] ?? "");
      if (repo !== "") return { source: "azure", fullName: `${org}/${repo}/${repo}`, url: cleaned };
    }
    return null;
  }

  return null;
}

// Extracts deduplicated GitHub and Azure DevOps repository URLs from a mission brief, in order of appearance.
export function extractMentionedRepositories(text: string): MentionedRepository[] {
  const seen = new Set<string>();
  const out: MentionedRepository[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const repo = parseRepoUrl(match[0]);
    if (repo === null) continue;
    const key = `${repo.source}:${repo.fullName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(repo);
  }
  return out;
}

const sameRepo = (a: { source: AccessConnector; fullName: string }, b: { source: AccessConnector; fullName: string }): boolean =>
  a.source === b.source && a.fullName.toLowerCase() === b.fullName.toLowerCase();

export function isMentionAttached(
  mention: MentionedRepository,
  chosen: readonly MissionRepositoryRequest[],
  known: readonly OfferedRepository[],
): boolean {
  return chosen.some((c) => {
    if (c.source !== mention.source) return false;
    if (c.id.toLowerCase() === mention.fullName.toLowerCase()) return true;
    const matched = known.find((r) => r.source === c.source && r.id === c.id);
    return matched !== undefined && sameRepo(matched, mention);
  });
}

export function diagnoseUnattachedRepositories(input: {
  mentions: readonly MentionedRepository[];
  chosen: readonly MissionRepositoryRequest[];
  offered: readonly OfferedRepository[];
  delegating: boolean;
  access: EmployeeAccess | null;
  sources: SourcesStatus | null;
  listed: Record<AccessConnector, RepositoryList | null>;
  loading: boolean;
}): MentionedRepositoryDiagnosis[] {
  const out: MentionedRepositoryDiagnosis[] = [];
  for (const mention of input.mentions) {
    if (isMentionAttached(mention, input.chosen, input.offered)) continue;

    const offeredMatch = input.offered.find((r) => sameRepo(r, mention)) ?? null;
    if (offeredMatch !== null) {
      out.push({ kind: "ready_to_attach", mention, repo: offeredMatch, delegating: input.delegating });
      continue;
    }

    const sourceStatus = input.sources?.sources.find((s) => s.source === mention.source) ?? null;
    if (sourceStatus !== null && sourceStatus.state !== "connected") {
      out.push({ kind: "connector_disconnected", mention, delegating: input.delegating });
      continue;
    }

    if (!input.delegating) {
      if (input.access !== null) {
        const grant = input.access.connectors.find((c) => c.connector === mention.source);
        if (grant === undefined || !grant.enabled) {
          out.push({ kind: "missing_access_grant", mention, connectorEnabled: false });
          continue;
        }
        if (grant.repositories !== null) {
          // Granted only specific repositories, and this one was not among offeredMatch.
          out.push({ kind: "missing_access_grant", mention, connectorEnabled: true });
          continue;
        }
        // Granted every repository on the connector: check whether the connector listing has loaded.
        if (input.listed[mention.source] !== null) {
          out.push({ kind: "not_listed", mention, delegating: false });
          continue;
        }
        if (input.loading) continue;
        out.push({ kind: "unknown_availability", mention, delegating: false });
        continue;
      }
      if (input.loading) continue;
      out.push({ kind: "unknown_availability", mention, delegating: false });
      continue;
    }

    // Delegating (CEO or Department): attachment draws from connected account repositories.
    if (sourceStatus !== null && sourceStatus.state === "connected") {
      if (input.listed[mention.source] !== null) {
        out.push({ kind: "not_listed", mention, delegating: true });
        continue;
      }
      if (input.loading) continue;
    }
    if (input.loading) continue;
    out.push({ kind: "unknown_availability", mention, delegating: true });
  }
  return out;
}
