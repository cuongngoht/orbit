import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER_HOSTS } from "./employee-network.js";
import { modelPlaneVerdict } from "./model-plane-egress.js";

const hosts = new Set(Object.values(PROVIDER_HOSTS).flat());

test("a model plane reaches the AI providers' own hosts on 443, and nothing else", () => {
  assert.equal(modelPlaneVerdict(hosts, { host: "api.anthropic.com", port: 443 }).allow, true);
  assert.equal(modelPlaneVerdict(hosts, { host: "API.OPENAI.COM", port: 443 }).allow, true);
  assert.equal(modelPlaneVerdict(hosts, { host: "api.anthropic.com", port: 80 }).allow, false);
  assert.equal(modelPlaneVerdict(hosts, { host: "pypi.org", port: 443 }).allow, false);
  assert.equal(modelPlaneVerdict(hosts, { host: "attacker.example", port: 443 }).allow, false);
  assert.match(modelPlaneVerdict(hosts, { host: "attacker.example", port: 443 }).reason, /providers' own hosts only/);
});
