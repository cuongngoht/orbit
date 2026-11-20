// What the Azure DevOps REST API answers (through `az rest`, which holds the token), read into Orbit Web's own shapes.
// Every function is pure and refuses what does not look right rather than guess: an organization name that is not
// one, a repository whose clone URL is not an https URL on Azure DevOps.
import { isAzureOrganization, isGuid, type Branch, type Repository } from "@orbit-web/contracts";

// The Azure DevOps resource the Azure CLI asks Microsoft Entra ID for a token for (Microsoft Learn: "Issue Entra
// tokens with Azure CLI").
export const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

const VERSION = "api-version=7.1";

export const azureUrls = {
  profile: (): string => `https://app.vssps.visualstudio.com/_apis/profile/profiles/me?${VERSION}`,
  accounts: (memberId: string): string => `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${encodeURIComponent(memberId)}&${VERSION}`,
  repositories: (organization: string): string => `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories?${VERSION}`,
  refs: (organization: string, repositoryId: string): string => `https://dev.azure.com/${encodeURIComponent(organization)}/_apis/git/repositories/${repositoryId}/refs?filter=heads/&${VERSION}`,
};

// A repository as Orbit Web keeps it, and the URL it is cloned from.
export interface AzureRepository extends Repository {
  cloneUrl: string;
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function json(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

const values = (stdout: string): Json[] => {
  const v = json(stdout);
  const list = isRecord(v) && Array.isArray(v.value) ? v.value : [];
  return list.filter(isRecord);
};

export function parseProfile(stdout: string): { id: string; displayName: string | null; email: string | null } | null {
  const v = json(stdout);
  if (!isRecord(v) || !isGuid(v.id)) return null;
  return { id: v.id, displayName: str(v.displayName), email: str(v.emailAddress) };
}

// The organizations the signed-in account is a member of.
export const parseAccounts = (stdout: string): string[] => [...new Set(values(stdout).map((a) => str(a.accountName)).filter(isAzureOrganization))];

// The https clone URL of a repository of this organization, with any user name removed (Azure DevOps puts the
// organization there); anything else is refused.
export function cloneUrlOf(remoteUrl: unknown, organization: string): string | null {
  if (typeof remoteUrl !== "string") return null;
  let url: URL;
  try {
    url = new URL(remoteUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const onAzure = host === "dev.azure.com" || host === `${organization.toLowerCase()}.visualstudio.com`;
  if (url.protocol !== "https:" || !onAzure || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  url.username = "";
  return url.toString();
}

export function parseRepositories(stdout: string, organization: string): AzureRepository[] {
  return values(stdout).flatMap((r) => {
    const id = str(r.id)?.toLowerCase() ?? null;
    const name = str(r.name);
    const project = isRecord(r.project) ? str(r.project.name) : null;
    const cloneUrl = cloneUrlOf(r.remoteUrl, organization);
    if (!isGuid(id) || name === null || project === null || cloneUrl === null) return [];
    const visibility = isRecord(r.project) ? str(r.project.visibility) : null;
    return [
      {
        source: "azure",
        id: `${organization}/${id}`,
        fullName: `${organization}/${project}/${name}`,
        owner: organization,
        project,
        name,
        private: visibility !== "public",
        defaultBranch: str(r.defaultBranch)?.replace(/^refs\/heads\//, "") ?? null,
        updatedAt: isRecord(r.project) ? str(r.project.lastUpdateTime) : null,
        archived: r.isDisabled === true,
        fork: r.isFork === true,
        cloneUrl,
      } satisfies AzureRepository,
    ];
  });
}

export function parseRefs(stdout: string, defaultBranch: string | null): Branch[] {
  return values(stdout).flatMap((ref) => {
    const name = str(ref.name);
    if (name === null || !name.startsWith("refs/heads/")) return [];
    const branch = name.slice("refs/heads/".length);
    return [{ name: branch, protected: ref.isLocked === true, commit: str(ref.objectId), isDefault: branch === defaultBranch }];
  });
}
