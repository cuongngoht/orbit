// The form's checks on a managed server's secrets, over plain values: the same
// rules the server holds, asked before anything is sent -- and never repeating
// what was typed. (.test.tsx on purpose: see src/features/skills/SkillsPage.test.tsx.)
import { describe, expect, it } from "vitest";
import { capabilityOptions } from "./CapabilityPicker";
import { cleanHeaderName, envListIssue, headerIssues, idIssue, looksLikeSecret, slugOf, suggestedEnv } from "./validate";
import { fakeResources } from "../../testing/fakeResources";
import { required } from "../../testing/required";

describe("header rows", () => {
  it("a token pasted where the variable's NAME belongs is recognised, and the message never repeats it", () => {
    const issues = headerIssues({ name: '"Authorization"', env: '"Bearer acme_mcp__FAKE-token-123"' });
    expect(issues.secret).toBe(true);
    expect(issues.name).toBe("Without quotes or a colon: Authorization");
    expect(issues.env).toMatch(/looks like the secret itself/);
    expect(`${issues.name} ${issues.env}`).not.toMatch(/acme_mcp/);
  });

  it("an empty variable, an invalid one and a good one each say what they are", () => {
    expect(headerIssues({ name: "Authorization", env: "" }).env).toBe("Name the environment variable that holds the value.");
    expect(headerIssues({ name: "Authorization", env: "corp-docs-auth" }).env).toMatch(/letters, digits and _/);
    expect(headerIssues({ name: "Authorization", env: "ACME_MCP_TOKEN" })).toEqual({ name: undefined, env: undefined, secret: false });
    expect(headerIssues({ name: "", env: "" })).toEqual({ secret: false });
  });

  it("what a secret looks like, and what a name looks like", () => {
    for (const secret of ["Bearer abc", "basic dXNlcjpw", '"quoted"', "acme_mcp__CANARY-0000000000-CANARY-0000000000"]) expect(looksLikeSecret(secret)).toBe(true);
    for (const name of ["ACME_MCP_TOKEN", "API_KEY", "x"]) expect(looksLikeSecret(name)).toBe(false);
  });

  it("a header written the curl way names the same header, and a suggested variable is one a shell accepts", () => {
    expect(cleanHeaderName('"Authorization"')).toBe("Authorization");
    expect(cleanHeaderName("Authorization:")).toBe("Authorization");
    expect(suggestedEnv("Test", '"Authorization"')).toBe("TEST_AUTHORIZATION");
    expect(suggestedEnv("acme-docs", "X-Api-Key")).toBe("ACME_DOCS_X_API_KEY");
    expect(suggestedEnv("1docs", "Authorization")).toBe("_1DOCS_AUTHORIZATION");
  });

  it("a stdio server's variable list names the line that is wrong", () => {
    expect(envListIssue("API_TOKEN\nOTHER")).toBeUndefined();
    expect(envListIssue("API_TOKEN\nBearer xyz")).toMatch(/^Line 2 looks like a secret/);
    expect(envListIssue("API_TOKEN\nnot-a-name")).toMatch(/^Line 2 is not an environment variable name/);
  });
});

describe("server ids", () => {
  it("spaces and accents are not an id, and a usable one is made from them", () => {
    expect(idIssue("AcmeDocs MCP")).toMatch(/no spaces or accents/);
    expect(idIssue("acmedocs")).toBeUndefined();
    expect(idIssue("")).toBeUndefined();
    expect(slugOf("AcmeDocs MCP")).toBe("acmedocs-mcp");
    expect(slugOf("Café Đata Gateway")).toBe("cafe-data-gateway");
    expect(slugOf("  --Test--  ")).toBe("test");
  });
});

describe("capability options", () => {
  it("are derived from the registry: what skills need, with who, first -- and a CLI command is never one", async () => {
    const resources = await required(fakeResources().handle({ method: "GET", path: "/api/v1/router/resources", headers: {}, body: undefined }), "the router resources answer").json();
    const options = capabilityOptions(resources.resources);
    expect(options.find((o) => o.value === "documentation.microsoft")?.neededBy).toEqual([{ id: "orbit-develop", level: "optional" }]);
    expect(options.find((o) => o.value === "project.context")?.neededBy).toEqual([{ id: "orbit-develop", level: "required" }]);
    expect(options.find((o) => o.value === "azure.documentation")).toEqual({ value: "azure.documentation", neededBy: [], providedBy: ["microsoft-learn"] });
    expect(options.some((o) => o.value.startsWith("command:"))).toBe(false);
    expect(capabilityOptions(undefined)).toEqual([]);
  });
});
