// Unattended: stay awake, open one signed-in browser per identity, wait for
// each to settle, run the cases in order, close everything, summarise.
import { spawnSync } from "node:child_process";
import { createBrowser } from "../browser/index.mjs";
import { findCase } from "../dsl/index.mjs";
import { Refused } from "../run/errors.mjs";
import { envKey } from "../identity/index.mjs";
import { fromEnv, varName } from "../project/env.mjs";
import { choices, launch, runDirFor } from "./launcher.mjs";
import { awaitShell } from "./shell.mjs";
import { runtimePath, runtimeSession } from "../project/runtime.mjs";
import { sessionName } from "../browser/session.mjs";

export const groupCases = (argv) => argv.reduce((g, a) => (a === "--" ? [...g, []] : (g[g.length - 1].push(a), g)), [[]]).filter((g) => g.length);

// Which identities the cases name -- each needs its own signed-in browser.
export function identitiesOf(ctx, groups) {
  const of = (c) => (c?.identities ? Object.keys(c.identities) : c?.identity ? [c.identity.as] : []);
  return [...new Set(groups.flatMap((g) => of(findCase(ctx.project.screensDir, g[0]))))];
}

export function openAll(ctx, wanted, say) {
  const opts = choices(ctx.env, ctx.config);
  if (!ctx.config.launcher) throw new Refused("no `launcher` in ui-tests/project.json — run-awake cannot open a browser without one");
  const plan = wanted.length ? wanted.map((as) => ({ as, profile: ctx.identity.resolve(as).profile })) : [{ as: null, profile: opts.profile }];
  return plan.map((p) => openOne(ctx, opts, p, say));
}

function openOne(ctx, opts, p, say) {
  if (!p.profile) throw new Refused(profileHint(p, ctx));
  const dir = runtimePath(ctx.project, p.as ? runDirFor(p.as, ctx.config.runDir) : ctx.config.runDir);
  const { runDir, target, out } = launch(ctx.config.launcher, opts, p.profile, dir);
  if (!runDir || !target) throw new Refused(`${out.trim()}\n\nthe launcher did not report a run directory — its output is above`);
  return settle(ctx, opts, { ...p, runDir, target, isolate: ctx.project?.layout === 3 }, say);
}

const profileHint = (p, ctx) => (p.as
  ? `case needs identity "${p.as}" but this machine maps it to no profile.\n  Sign one in once, then: echo '{"${p.as}": "<profile-name>"}' > ${ctx.identity.mapFile}`
  : `no identity in the case and no ${varName("PROFILE")} — set ${varName("PROFILE")}=<profile-name>`);

function settle(ctx, opts, o, say) {
  announce(ctx, opts, o, say);
  const host = new URL(o.target).host;
  const state = awaitShell(createBrowser(runtimePath(ctx.project, o.runDir), { signInHosts: ctx.config.signIn.hosts, isolate: o.isolate, guard: (dir) => runtimeSession(ctx.project, dir) }), host, say);
  if (state !== host) throw new Refused(unusable(state, opts, o, ctx));
  return o;
}

function announce(ctx, opts, o, say) {
  if (o.as) ctx.env[varName(`SESSION_${envKey(o.as)}`)] = o.runDir;
  say(`browser : ${o.as ? o.as + " → " : ""}profile ${o.profile} · ${opts.channel} ${opts.mode} · ${opts.env}\nrun dir : ${o.runDir}`);
}

function unusable(state, opts, o, ctx) {
  closeAll([o], ctx.env);
  if (state === "SIGNIN") return `session : parked on a sign-in page. Headless cannot show an interactive sign-in — sign in once with a window:\n  node ${ctx.config.launcher} --channel ${opts.channel} --headed --env ${opts.env} --profile ${o.profile}\nthen re-run this.`;
  return `session : ${state} — the browser never reached ${new URL(o.target).host}`;
}

export function closeAll(opened, env) {
  if (fromEnv(env, "KEEP_OPEN")) return;
  for (const o of opened) spawnSync("playwright-cli", [...(o.isolate ? [`-s=${sessionName(o.runDir)}`] : []), "close"], { cwd: o.runDir, stdio: "ignore" });
}

export function runAll(groups, runCaseBin, env, say) {
  const results = [];
  for (const g of groups) {
    say(`\n━━ ${g[0]} ━━`);
    const rc = spawnSync("node", [runCaseBin, ...g], { stdio: "inherit", env });
    results.push({ id: g[0], code: rc.status ?? 1 });
    if (rc.status && !fromEnv(env, "CONTINUE")) break;
  }
  return results;
}
