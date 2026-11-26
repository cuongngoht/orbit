// THE RELEASE'S OWN QUESTIONS (scripts/release.mjs): which image tags a file names that are not the version released
// (a compose file left on a release candidate would pull it), which of the four images has no digest, and the notes
// that name all four by digest and say how to run them. Fixtures only: the tree itself is asked by `verify`, when a
// release runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGES, bridgeVersion, changelogSection, digestsOf, internalPins, lockProblems, otherTags, releaseNotes, webVersionArg } from "./release.mjs";

const COMPOSE = `
#   ORBIT_WEB_TAG=0.8.0-rc02                 the images' tag
    image: ghcr.io/acme/orbit-web:\${ORBIT_WEB_TAG:-0.8.0-rc02}
      ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION: \${ORBIT_WEB_WORKSTATION_IMAGE:-ghcr.io/acme/orbit-web-workstation:\${ORBIT_WEB_TAG:-0.8.0-rc02}}
#   docker build --target model-plane -t ghcr.io/acme/orbit-web-model-plane:0.8.0-rc01 .
      ORBIT_WEB_CONTROL_PLANE_LIMITS: "orbit-web:1.0:2g,postgres:0.5:768m"
`;
const digest = (c) => `sha256:${c.repeat(64)}`;

test("a release candidate's tag is named wherever a file gives the images one, the ORBIT_WEB_TAG default and its documentation included", () => {
  assert.deepEqual(new Set(otherTags(COMPOSE, "0.8.0")), new Set(["0.8.0-rc02", "0.8.0-rc01"]));
  assert.deepEqual(otherTags("one file that runs `ghcr.io/acme/orbit-web*:0.8.0-rc02`", "0.8.0"), ["0.8.0-rc02"], "the README's wildcard for all four");
});

test("the version itself, `latest`, a placeholder and a limit that only looks like a tag are not other tags", () => {
  const released = COMPOSE.replaceAll("0.8.0-rc02", "0.8.0").replaceAll("0.8.0-rc01", "0.8.0");
  assert.deepEqual(otherTags(released, "0.8.0"), []);
  assert.deepEqual(otherTags("pushes `ghcr.io/<owner>/orbit-web:<version>` (and `ghcr.io/acme/orbit-web:latest` only when asked)", "0.8.0"), []);
  assert.deepEqual(otherTags('ORBIT_WEB_CONTROL_PLANE_LIMITS: "orbit-web:1.0:2g"', "0.8.0"), []);
});

test("the notes need a digest for each of the four images, and say which is missing", () => {
  const all = IMAGES.map((name, i) => `${name}=${digest("abcd"[i])}`).join(",");
  assert.deepEqual(Object.keys(digestsOf(all).digests ?? {}).sort(), [...IMAGES].sort());
  assert.deepEqual(digestsOf(IMAGES.slice(0, 3).map((name) => `${name}=${digest("a")}`).join(",")).missing, ["orbit-web-storage-helper"]);
  assert.deepEqual(digestsOf(`orbit-web=sha256:short,${IMAGES.slice(1).map((name) => `${name}=${digest("b")}`).join(",")}`).missing, ["orbit-web"], "a digest that is not one");
  assert.deepEqual(digestsOf(null).missing, IMAGES);
});

test("the notes: the changelog section first, the four images by tag and digest, and the one file that runs them, at the commit", () => {
  const digests = Object.fromEntries(IMAGES.map((name, i) => [name, digest("abcd"[i])]));
  const notes = releaseNotes({ section: "Orbit Web becomes an office.", version: "0.8.0", registry: "ghcr.io/acme", repository: "acme/orbit", commit: "c0ffee", digests, latest: false, plugin: "0.6.0" });
  assert.ok(notes.startsWith("Orbit Web becomes an office.\n"), notes);
  for (const name of IMAGES) assert.ok(notes.includes(`\`ghcr.io/acme/${name}:0.8.0\`: \`ghcr.io/acme/${name}@${digests[name]}\``), name);
  assert.ok(notes.includes("curl -fsSL https://raw.githubusercontent.com/acme/orbit/c0ffee/integrations/orbit-web/docker/compose.published.yaml -o compose.yaml"));
  assert.ok(notes.includes("Orbit 0.6.0"));
  assert.ok(!notes.includes("latest"), "latest only when asked");
  assert.ok(releaseNotes({ section: "", version: "0.8.0", registry: "ghcr.io/acme", repository: "acme/orbit", commit: "c0ffee", digests, latest: true, plugin: "0.6.0" }).includes("(also `latest`)"));
});

test("a changelog section ends where the next one starts", () => {
  const text = "# Changelog\n\n## Orbit Web 0.8.0\n\nThe office.\n\n## Orbit Web 0.7.0\n\nThe browser.\n";
  assert.equal(changelogSection(text, "0.8.0"), "The office.");
  assert.equal(changelogSection(text, "0.9.0"), null);
});

test("a workspace pinning another at an older version is named, wherever the pin is", () => {
  const manifest = { name: "@orbit-web/api", version: "0.8.1", dependencies: { "@orbit-web/contracts": "0.8.0", express: "4.0.0" }, devDependencies: { "@orbit-web/governance-core": "0.8.1" } };
  assert.deepEqual(internalPins(manifest, "0.8.1"), ["@orbit-web/contracts 0.8.0"]);
  assert.deepEqual(internalPins({ name: "x", version: "0.8.1" }, "0.8.1"), []);
});

test("the lock file says the version for the root and every workspace, and each workspace's pins", () => {
  const lock = {
    name: "orbit-web",
    version: "0.8.1",
    packages: {
      "": { name: "orbit-web", version: "0.8.1" },
      "apps/api": { name: "@orbit-web/api", version: "0.8.0", dependencies: { "@orbit-web/contracts": "0.8.0", pg: "8.0.0" } },
      "node_modules/@orbit-web/api": { resolved: "apps/api", link: true },
      "node_modules/some-library": { version: "0.8.0" },
    },
  };
  assert.deepEqual(lockProblems(lock, "0.8.1"), ["package-lock.json apps/api says 0.8.0", "package-lock.json apps/api pins @orbit-web/contracts 0.8.0"]);
  assert.deepEqual(lockProblems({ ...lock, version: "0.8.0", packages: { "": { version: "0.8.1" } } }, "0.8.1"), ["package-lock.json says 0.8.0"]);
});

test("the image's own version is its WEB_VERSION argument", () => {
  assert.equal(webVersionArg("FROM node AS web\nARG WEB_VERSION=0.8.1\nLABEL version=$WEB_VERSION\n"), "0.8.1");
  assert.equal(webVersionArg("FROM node\n"), null);
});

test("the tool bridge says the release's version to the AI CLI it serves", () => {
  assert.equal(bridgeVersion('return { serverInfo: { name: "orbit_tools", version: "0.8.1" } };'), "0.8.1");
  assert.equal(bridgeVersion("nothing here"), null);
});
