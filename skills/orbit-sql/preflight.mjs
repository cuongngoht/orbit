// "Can this machine read the database at all?" -- asked once, in one command,
// before a case blames the product for a laptop that is off the VPN.
//
// It reports the answer AND where each setting came from, because the commonest
// failure here is not a wrong password: it is a variable set in a terminal that
// this process never saw (settings.mjs explains why it cannot).
import { PREFIX, childEnv, connection, sqlcmdArgs } from "./args.mjs";
import { KEYS, SECRET, modeWarning, redact, resolveSettings } from "./settings.mjs";
import { parseRows } from "../../src/database/rows.mjs";

// Read-only, and it answers the only two questions worth asking before a run:
// can I connect, and is this login as harmless as it is supposed to be. Parsed
// with the ENGINE's row parser, so a probe that reads here reads there too.
export const PROBE = "SELECT DB_NAME() AS db, SUSER_SNAME() AS login, IS_ROLEMEMBER('db_datareader') AS reader, IS_ROLEMEMBER('db_owner') AS owner";

const WHERE = `An export run AFTER this process started cannot reach it — the environment was
inherited at launch. Two ways forward:
  ~/.orbit/sql.env      works in THIS session, no restart
  the shell profile    works from the NEXT session onward
Both, printed for your OS:  node <plugin>/skills/orbit-sql/sqlcmd.mjs setup-hint`;

export function preflight(deps) {
  const { settings, sources } = resolveSettings(deps.env, deps.fileText, deps.configFile);
  const bin = deps.which(settings[PREFIX + "BIN"] || "sqlcmd");
  const said = [`sqlcmd${" ".repeat(PREFIX.length + 5)}: ${bin ?? `MISSING — ${deps.installHint}`}`, ...settingLines(settings, sources), ...(deps.warning ? [`permissions: ${deps.warning}`] : [])];
  const c = connection(settings);
  return bin && !c.problem ? probed(deps, settings, c, said) : { lines: [...said, "", notReady(bin, c, deps)], code: 2 };
}

export const warningFor = (file) => modeWarning(file);

const settingLines = (settings, sources) => KEYS.map((k) => `${(PREFIX + k).padEnd(PREFIX.length + 11)}: ${shown(settings, sources, k)}`);

// The password's LENGTH, never the password: enough to tell "set to the wrong
// thing" from "not set", and nothing a screen share can leak.
function shown(settings, sources, k) {
  const value = settings[PREFIX + k];
  if (!value) return "not set";
  return `${PREFIX + k === SECRET ? `set (${value.length} chars)` : value} [${sources[k]}]`;
}

function probed(deps, settings, c, said) {
  const r = deps.spawn(c.bin, sqlcmdArgs(c, PROBE), { encoding: "utf8", env: childEnv(settings), timeout: (c.timeout + 15) * 1000 });
  const out = redact((r.stdout ?? "") + (r.stderr ?? r.error?.message ?? ""), settings[SECRET]);
  if (r.status !== 0) return { lines: [...said, "", "connection : FAILED", out.trim()], code: r.status ?? 1 };
  return { lines: [...said, "", "connection : OK", ...describe(out)], code: 0 };
}

// The login's own answer about itself: which database, as whom, and whether the
// account could write if a query asked it to.
function describe(out) {
  const row = parseRows(out)[0];
  if (!row) return [out.trim()];
  return [`database   : ${row.db}`, `login      : ${row.login}   db_datareader=${row.reader}  db_owner=${row.owner}`, ...privilege(row)];
}

// THE POLICY, in one line, and the place to change it: db_owner is reported and
// the preflight still passes. The account is the real read-only guarantee and
// the regex in args.mjs is only the backstop for a target configured with the
// wrong login -- but plenty of dev databases make everybody dbo, and a tool that
// refuses to run there is a tool people route around. Make this a non-zero exit
// if your environment can promise db_datareader.
const privilege = (row) => (row.owner === "1" ? ["", "NOTE: this login is db_owner — it CAN write. Only the client-side check in", "args.mjs stands between a typo and a change. Ask for db_datareader instead."] : []);

const notReady = (bin, c, deps) => (bin ? `${c.problem}\n\n${WHERE.replace("~/.orbit/sql.env", deps.configFile ?? "~/.orbit/sql.env")}` : `sqlcmd is not on PATH — install it: ${deps.installHint}`);
