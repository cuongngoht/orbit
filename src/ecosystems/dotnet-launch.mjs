// A launch settings file: the profiles a project DECLARES it can be started
// with, and the addresses each one says it listens on.
//
// Only a profile whose command is the project itself is a way to START it. The
// others -- a web server the IDE wraps, an executable somewhere else -- say
// nothing this adapter can turn into a command, and are left out with a
// sentence rather than guessed at. Each runnable profile is one `start:<name>`
// command, so a person who wants the second one picks it by name and nobody has
// to be told what "the" start command is.
//
// A name that a command line could not carry as one word is left out and said:
// a profile called `a b` cannot be an argument here, because nothing in this
// engine ever hands a command to a shell.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// How the project is told which address to listen on, whatever its profile says: an argument after `--`, which a
// command-line configuration source outranks both the profile's environment and appsettings with.
const PORT_OVERRIDE = { kind: "argv", after: "--", flag: "--urls", format: "http://127.0.0.1:{port}" };

export function launchProfiles(json) {
  if (!isObject(json)) return null;
  const all = Object.entries(isObject(json.profiles) ? json.profiles : {}).filter(([, p]) => isObject(p));
  const runnable = all.filter(([, p]) => p.commandName === "Project");
  const named = runnable.filter(([name]) => SAFE_NAME.test(name));
  return { runtime: "dotnet", commands: named.map(([name, p]) => [`start:${name}`, `dotnet run --launch-profile ${name}`, portsOf([[name, p]]), PORT_OVERRIDE]), ports: portsOf(named), unknowns: skipped(all, runnable, named) };
}

// The ports of the profiles given: every profile's for the project, and ONE profile's for the command
// that starts it -- a port only another profile opens is not one to wait for.
const portsOf = (profiles) => [...new Set(profiles.flatMap(([, p]) => String(p.applicationUrl ?? "").split(";").map(portOf).filter(Boolean)))].sort((a, b) => a - b);

// A URL with no port names its scheme's own: `http://localhost` is port 80. Dropping it would make a
// project that says so declare nothing, and an approved environment on that port would never be held
// to it.
const DEFAULT_PORT = { "http:": 80, "https:": 443 };

function portOf(url) {
  try {
    const parsed = new URL(url.trim());
    return Number(parsed.port) || DEFAULT_PORT[parsed.protocol] || null;
  } catch {
    return null;
  }
}

function skipped(all, runnable, named) {
  const wrapped = all.length - runnable.length;
  const odd = runnable.length - named.length;
  return [...(wrapped ? [`${wrapped} launch profile(s) do not run the project itself, so no command is read from them`] : []), ...(odd ? [`${odd} launch profile name(s) cannot be carried as one command-line word, so no command is read from them`] : [])];
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
