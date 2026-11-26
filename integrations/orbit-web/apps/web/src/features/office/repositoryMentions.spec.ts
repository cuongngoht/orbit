import { describe, expect, test } from "vitest";
import type { EmployeeAccess, RepositoryList, SourcesStatus } from "@orbit-web/contracts";
import { diagnoseUnattachedRepositories, extractMentionedRepositories, isMentionAttached } from "./repositoryMentions";

describe("extractMentionedRepositories", () => {
  test("extracts GitHub and Azure DevOps repository URLs, strips subpaths and punctuation, and deduplicates", () => {
    const brief = [
      "Audit https://github.com/cuongngoht/orbit/tree/main/integrations/orbit-web and [same repo](https://github.com/CUONGNGOHT/ORBIT.git).",
      "Also review https://dev.azure.com/contoso/Core%20Platform/_git/billing-api?version=GBmain,",
      "https://dev.azure.com/contoso/_git/docs-site,",
      "and https://fabrikam.visualstudio.com/DefaultCollection/App/_git/web-portal.",
      "Ignore https://github.com/settings/tokens and https://github.com/orgs/contoso/repositories.",
    ].join("\n");

    expect(extractMentionedRepositories(brief)).toEqual([
      { source: "github", fullName: "cuongngoht/orbit", url: "https://github.com/cuongngoht/orbit/tree/main/integrations/orbit-web" },
      { source: "azure", fullName: "contoso/Core Platform/billing-api", url: "https://dev.azure.com/contoso/Core%20Platform/_git/billing-api?version=GBmain" },
      { source: "azure", fullName: "contoso/docs-site/docs-site", url: "https://dev.azure.com/contoso/_git/docs-site" },
      { source: "azure", fullName: "fabrikam/App/web-portal", url: "https://fabrikam.visualstudio.com/DefaultCollection/App/_git/web-portal" },
    ]);
  });
});

describe("diagnoseUnattachedRepositories", () => {
  const connectedSources: SourcesStatus = {
    sources: [
      { source: "github", state: "connected", account: "octocat" },
      { source: "azure", state: "connected", account: "contoso" },
    ],
  };
  const emptyList: RepositoryList = { source: "github", repositories: [], fetchedAt: "2026-11-26T00:00:00Z", partial: false };
  const ghMention = extractMentionedRepositories("Inspect https://github.com/octo/app");
  const azMention = extractMentionedRepositories("Inspect https://dev.azure.com/contoso/Core/_git/api");

  test("distinguishes missing mission attachment when employee already has access", () => {
    const offered = [{ source: "github" as const, id: "octo/app", fullName: "octo/app" }];
    const access: EmployeeAccess = {
      employeeId: "e1",
      connectors: [
        {
          connector: "github",
          enabled: true,
          repositories: [{ id: "octo/app", fullName: "octo/app", owner: "octo", project: null, name: "app" }],
          write: false,
          grantedAt: "2026-11-26T00:00:00Z",
        },
      ],
      knowledge: [],
    };
    const res = diagnoseUnattachedRepositories({
      mentions: ghMention,
      chosen: [],
      offered,
      delegating: false,
      access,
      sources: connectedSources,
      listed: { github: null, azure: null },
      loading: false,
    });
    expect(res).toEqual([{ kind: "ready_to_attach", mention: ghMention[0], repo: offered[0], delegating: false }]);
    expect(isMentionAttached(ghMention[0]!, [{ source: "github", id: "octo/app", branch: null }], offered)).toBe(true);
  });

  test("distinguishes missing access grant on direct employee when connector is connected", () => {
    const access: EmployeeAccess = {
      employeeId: "e1",
      connectors: [{ connector: "github", enabled: false, repositories: null, write: false, grantedAt: null }],
      knowledge: [],
    };
    const res = diagnoseUnattachedRepositories({
      mentions: ghMention,
      chosen: [],
      offered: [],
      delegating: false,
      access,
      sources: connectedSources,
      listed: { github: emptyList, azure: null },
      loading: false,
    });
    expect(res).toEqual([{ kind: "missing_access_grant", mention: ghMention[0], connectorEnabled: false }]);
  });

  test("reports disconnected connector for Azure DevOps when connector is not signed in", () => {
    const sources: SourcesStatus = {
      sources: [
        { source: "github", state: "connected", account: "octocat" },
        { source: "azure", state: "not_connected", account: null },
      ],
    };
    const res = diagnoseUnattachedRepositories({
      mentions: azMention,
      chosen: [],
      offered: [],
      delegating: true,
      access: null,
      sources,
      listed: { github: null, azure: null },
      loading: false,
    });
    expect(res).toEqual([{ kind: "connector_disconnected", mention: azMention[0], delegating: true }]);
  });

  test("reports ready_to_attach with delegating=true for CEO/department when attached list is empty", () => {
    const offered = [{ source: "azure" as const, id: "contoso/repo-uuid-1", fullName: "contoso/Core/api" }];
    const res = diagnoseUnattachedRepositories({
      mentions: azMention,
      chosen: [],
      offered,
      delegating: true,
      access: null,
      sources: connectedSources,
      listed: { github: null, azure: { source: "azure", repositories: [], fetchedAt: "2026-11-26T00:00:00Z", partial: false } },
      loading: false,
    });
    expect(res).toEqual([{ kind: "ready_to_attach", mention: azMention[0], repo: offered[0], delegating: true }]);
    // Once attached by UUID, isMentionAttached recognizes it via offered fullName.
    expect(
      diagnoseUnattachedRepositories({
        mentions: azMention,
        chosen: [{ source: "azure", id: "contoso/repo-uuid-1", branch: null }],
        offered,
        delegating: true,
        access: null,
        sources: connectedSources,
        listed: { github: null, azure: null },
        loading: false,
      }),
    ).toEqual([]);
  });
});
