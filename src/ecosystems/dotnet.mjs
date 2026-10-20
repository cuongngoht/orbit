// The MSBuild family of manifests, as ONE ecosystem adapter.
//
// Four shapes of file, one row each, and each says a different thing -- which
// is the whole difficulty, and why they are rows with their own reader rather
// than one regex over every `.props`:
//
//   a project file   (*.csproj, *.fsproj, *.vbproj)  a UNIT. Its package
//                    references are DIRECT: this unit asked for them.
//   a shared file    (Directory.Build.props/.targets) not a unit. The build
//                    imports it into every project beneath it, so a package
//                    reference here is IMPORTED -- real, and recorded against
//                    the file that actually says it, never against a project
//                    file that does not.
//   a central list   (Directory.Packages.props) not a unit. A PackageVersion
//                    here is MANAGED: a version made available. It is not a
//                    dependency of anything until a project references it, and
//                    reading it as one is the false positive this row exists to
//                    refuse. A GlobalPackageReference IS applied to every
//                    project, so it is imported.
//   an SDK pin       (global.json) the toolchain version, and nothing else.
//   launch settings  (launchSettings.json) not a unit: the profiles a project
//                    declares it can be started with, and the addresses they
//                    listen on (src/ecosystems/dotnet-launch.mjs).
//
// A lock file is deliberately absent. Everything in it is resolved, most of it
// transitively, and a transitive package is the resolver's decision rather
// than this project's architectural one.
//
// What a project file DECLARES about itself -- its targets, its SDK's kind -- is
// read. What it might DO is never inferred from that: a web SDK says what kind
// of project it is, and that is where this adapter's knowledge ends.
import { basename } from "node:path/posix";
import { launchProfiles } from "./dotnet-launch.mjs";
import { requirementsOf } from "./dotnet-targets.mjs";
import { elements, isProject, itemGroups, listOf, values, withoutComments } from "./msbuild.mjs";

const FILES = [
  { match: /\.(cs|fs|vb)proj$/i, read: projectFile },
  { match: /^Directory\.Build\.(props|targets)$/i, read: sharedFile },
  { match: /^Directory\.Packages\.props$/i, read: centralFile },
  { match: /^global\.json$/i, read: sdkPin },
  { match: /^launchSettings\.json$/i, read: launchSettings },
];

const rowFor = (path) => FILES.find((f) => f.match.test(basename(String(path)))) ?? null;

export const dotnet = {
  id: "dotnet",
  doc: "an MSBuild project, a shared build file, a central package list or an SDK pin",
  detects: (path) => rowFor(path) !== null,
  parseManifest: (path, text) => rowFor(path).read(String(text)),
};

function projectFile(raw) {
  const text = withoutComments(raw);
  if (!isProject(text)) return { unit: true, unknowns: [NOT_A_PROJECT] };
  const targets = targetsOf(text);
  const needs = requirementsOf(targets.known);
  return { unit: true, runtime: "dotnet", ...declaredBy(text), targets: targets.known, requires: needs.requires, unknowns: [...targets.unknowns, ...needs.unknowns, ...unread(text, "PackageReference"), ...unread(text, "ProjectReference")] };
}

// Every ProjectReference, a computed one too: one whose path is an MSBuild expression this read does not
// evaluate is kept AS WRITTEN, so it resolves to no unit and reads as UNRESOLVED -- what depends on what is
// then unknown, never assumed absent.
const projectReferences = (text) => itemGroups(text).flatMap((g) => elements(g.body, "ProjectReference")).flatMap((a) => listOf(a.Include)).map((path) => ({ path: path.replace(/[\\/]+/g, "/") }));

// A ProjectReference names another project of the same tree by PATH, as the file writes it (either
// separator): the one relation between two units a project file states. Resolving it to a unit that
// was read is the reader's; here it is only what the file says.
function declaredBy(text) {
  const dependencies = items(text, "PackageReference", "direct");
  const references = projectReferences(text);
  return { dependencies, references, kinds: kindsOf(text, dependencies) };
}

const NOT_A_PROJECT = "this file has no <Project> element, so nothing in it could be read as a build — its dependencies and targets are unknown, not absent";

// A shared file's target is a default for every project beneath it that sets none of its own, so what it
// REQUIRES is said here, where the file says it -- and which units that reaches is src/ecosystems/reach.mjs's.
function sharedFile(raw) {
  const text = withoutComments(raw);
  const targets = targetsOf(text);
  const needs = requirementsOf(targets.known);
  return { reach: "subtree", dependencies: items(text, "PackageReference", "imported"), targets: targets.known, requires: needs.requires, unknowns: [...targets.unknowns, ...needs.unknowns, ...unread(text, "PackageReference")] };
}

function centralFile(raw) {
  const text = withoutComments(raw);
  return { reach: "subtree", dependencies: [...items(text, "PackageVersion", "managed"), ...items(text, "GlobalPackageReference", "imported")], unknowns: [...unread(text, "PackageVersion"), ...unread(text, "GlobalPackageReference")] };
}

function sdkPin(raw) {
  const json = parsed(raw);
  if (!isObject(json)) return null;
  const version = typeof json.sdk?.version === "string" ? json.sdk.version : null;
  return { reach: "subtree", runtime: "dotnet", ...(version ? { sdk: version } : {}), unknowns: version ? [] : [NO_SDK_VERSION] };
}

const NO_SDK_VERSION = "this SDK pin names no version, so which toolchain builds the tree beneath it is whatever the machine has";

// `Include` is the declaration. `Update` changes a reference something else
// made and `Remove` takes one away, so neither is a dependency by itself.
const items = (text, element, relationship) => itemGroups(text).flatMap((g) => elements(g.body, element).flatMap((a) => item(a, g.attrs, relationship)));

function item(attrs, group, relationship) {
  const conditional = "Condition" in attrs || "Condition" in group;
  return listOf(attrs.Include).filter((n) => !isComputed(n)).map((name) => ({ name, relationship, ...(conditional ? { conditional: true } : {}) }));
}

// What this read saw and could not take: an item outside any closed group,
// or one whose name is an MSBuild expression it did not evaluate. Said, never
// silently dropped -- "no reference found" and "a reference was not read" send
// a reader to different places.
function unread(text, element) {
  const everywhere = elements(text, element).filter((a) => a.Include);
  const grouped = itemGroups(text).flatMap((g) => elements(g.body, element).filter((a) => a.Include));
  const computed = everywhere.filter((a) => listOf(a.Include).some(isComputed));
  return [...(everywhere.length > grouped.length ? [`${everywhere.length - grouped.length} ${element} element(s) sit outside a closed ItemGroup and were not read`] : []), ...(computed.length ? [`${computed.length} ${element} name(s) are computed from a property, and were not evaluated`] : [])];
}

const isComputed = (value) => /[$@%]\(/.test(value);

function targetsOf(text) {
  const all = [...values(text, "TargetFramework"), ...values(text, "TargetFrameworks"), ...values(text, "TargetFrameworkVersion")].flatMap(listOf);
  const known = [...new Set(all.filter((t) => !isComputed(t)))];
  return { known, unknowns: all.length > known.length && all.some(isComputed) ? ["a target framework is computed from a property, and was not evaluated"] : [] };
}

// The kind an SDK DECLARES, off its own name's last segment: `…Sdk.Web` is a
// web project, `…Sdk.Worker` a worker. A declaration, read -- never a claim
// about what the project does at runtime.
const SDK_KIND = /\.Sdk\.([A-Za-z]+)(?:\/.*)?$/;

function kindsOf(text, dependencies) {
  const sdks = [...elements(text, "Project").map((a) => a.Sdk), ...elements(text, "Sdk").map((a) => a.Name)].flatMap(listOf);
  const declared = sdks.map((s) => SDK_KIND.exec(s)?.[1]?.toLowerCase()).filter(Boolean);
  return [...new Set([...declared, ...(windowed(text) ? ["desktop"] : []), ...(webApplication(text) ? ["web"] : []), ...(isTestProject(text, dependencies) ? ["test"] : [])])];
}

// A classic web application declares itself by its project TYPE: the GUID a web application project
// is filed under. What it builds is a library a web server hosts, so without this it reads as one --
// and "a library is not something to start" hides that it is a web application only Windows runs.
const WEB_APPLICATION = "349c5851-65df-11da-9384-00065b846f21";

const webApplication = (text) => values(text, "ProjectTypeGuids").some((v) => v.toLowerCase().includes(WEB_APPLICATION));

// `OutputType` `WinExe` is a program with a window, which the file DECLARES -- in an old-style project
// too, which has no SDK name to say so. Without it a classic desktop application reads as a library,
// and "a library is not something to start" hides that it can only ever run on Windows.
const windowed = (text) => values(text, "OutputType").some((v) => v.toLowerCase() === "winexe");

// A project says it is a test project by a property, or by referencing the
// package that makes it one. Both are declarations in the file.
const TEST_SDK = /\.Test\.Sdk$/i;

const isTestProject = (text, dependencies) => values(text, "IsTestProject").some((v) => v.toLowerCase() === "true") || dependencies.some((d) => TEST_SDK.test(d.name));

function launchSettings(raw) {
  return launchProfiles(parsed(raw));
}

function parsed(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
