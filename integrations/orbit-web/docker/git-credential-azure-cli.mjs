#!/usr/bin/env node
// A GIT CREDENTIAL HELPER FOR ONE AZURE REPOS CLONE. Orbit Web runs `git clone` of an Azure DevOps repository with this
// helper named on that one command (`-c credential.helper=` resets every other helper first) and nothing written to
// the repository. Git asks it `get` with the host it is about to talk to; for Azure DevOps -- and only Azure DevOps --
// it asks the Azure CLI, signed in with Orbit Web's own profile (AZURE_CONFIG_DIR, given by Orbit Web to git and so to
// this helper), for a Microsoft Entra token for Azure DevOps (Microsoft Learn: "Authentication with Azure Repos") and
// hands it to git. The token goes from az to git for that request: it is never printed anywhere else, never stored
// (`store` and `erase` do nothing), and Orbit Web's own process never sees it. The coding agent has no such helper.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

// The hosts this helper answers for: dev.azure.com and an organization's <org>.visualstudio.com.
const answersFor = (host) => typeof host === "string" && (host.toLowerCase() === "dev.azure.com" || /^[a-z0-9][a-z0-9-]{0,49}\.visualstudio\.com$/i.test(host));

// What git wrote on stdin: key=value lines.
function parseRequest(text) {
  return Object.fromEntries(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

function main() {
  if (process.argv[2] !== "get") return;
  const request = parseRequest(readFileSync(0, "utf8"));
  if (request.protocol !== "https" || !answersFor(request.host)) return;
  const az = spawnSync("az", ["account", "get-access-token", "--resource", AZURE_DEVOPS_RESOURCE, "--query", "accessToken", "--output", "tsv"], { encoding: "utf8", env: process.env });
  const token = az.status === 0 ? az.stdout.trim() : "";
  if (token === "" || /\s/.test(token)) {
    process.stderr.write("orbit-web: the Azure CLI gave no Azure DevOps token (is Azure connected in Settings → Connectors?)\n");
    return;
  }
  process.stdout.write(`username=orbit-web\npassword=${token}\n`);
}

main();
