import assert from "node:assert/strict";
import { test } from "node:test";
import { bounded, redactSecrets, redactShapes, tail } from "./redact.js";

const GH = `gho_${"A1b2C3d4E5".repeat(4)}`;
const PAT = `github_pat_${"a".repeat(30)}_${"B".repeat(20)}`;
const ANT = `sk-ant-oat01-${"x".repeat(40)}`;

test("GitHub and Anthropic tokens are masked wherever they appear", () => {
  const out = redactSecrets(`token ${GH} and ${PAT} and key ${ANT}`);
  assert.doesNotMatch(out, /gho_|github_pat_|sk-ant-/);
  assert.match(out, /\[redacted-github-token\]/);
  assert.match(out, /\[redacted-anthropic-key\]/);
});

test("a gh hosts file line, a header and a URL with a password lose their secret", () => {
  assert.equal(redactSecrets(`    oauth_token: ${GH}`), "    oauth_token: [redacted-github-token]");
  assert.equal(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"), "Authorization: Bearer [redacted]");
  assert.equal(redactSecrets("https://user:s3cret@example.com/x"), "https://[redacted]@example.com/x");
});

test("an assignment of a secret-named variable is masked, ordinary code is not", () => {
  assert.equal(redactSecrets("GH_TOKEN=abc123"), "GH_TOKEN=[redacted]");
  assert.equal(redactSecrets('ANTHROPIC_API_KEY: "zzz"'), "ANTHROPIC_API_KEY: [redacted]");
  assert.equal(redactSecrets("const token = getToken();"), "const token = getToken();");
  assert.equal(redactShapes("API_KEY=abc"), "API_KEY=abc", "a diff keeps code as written; only token shapes are masked there");
});

test("JWTs, cloud keys and private keys are masked", () => {
  assert.equal(redactSecrets("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"), "[redacted-jwt]");
  assert.equal(redactSecrets("AKIAABCDEFGHIJKLMNOP"), "[redacted-access-key]");
  assert.equal(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----"), "[redacted-private-key]");
});

test("bounded and tail keep output small and masked", () => {
  assert.deepEqual(bounded("abcdef", 3), { text: "abc", truncated: true });
  assert.deepEqual(bounded("ab", 3), { text: "ab", truncated: false });
  assert.equal(tail(`a\nb\nc\nGH_TOKEN=${GH}\n`, 2), "c\nGH_TOKEN=[redacted-github-token]");
  assert.equal(tail("x\nMY_SECRET=plain\n", 1), "MY_SECRET=[redacted]");
});
