#!/usr/bin/env node
// node cli/host.mjs inspect|render|apply|remove --host=antigravity --target=<absolute hooks.json> [--revision=<sha>] [--replace]
// node cli/host.mjs settings --host=<id> [--revision=<n>]  (JSON settings on stdin when a revision is supplied)
// node cli/host.mjs inspect|render --host=claude --kind=statusline
// node cli/host.mjs apply --host=claude --kind=statusline --revision=<sha> [--replace | --keep-existing] --human
// node cli/host.mjs remove --host=claude --kind=statusline --revision=<sha> --human
//   Orbit Live's status line (README §4.16): ONE owned key, `statusLine`, in the user's own Claude Code settings,
//   naming a shim Orbit keeps in its store. A status line the person already has is refused unless they choose
//   --replace (theirs comes back on remove) or --keep-existing (theirs runs first, then Orbit's; not on Windows).
//   The revision is the one `render` printed; apply and remove are a person's, and say so with --human.
import { readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from '../src/project/command.mjs';
import { storeBase } from '../src/project/repository.mjs';
import { stateRooms, writeState } from '../src/store/control.mjs';
import { realIo } from '../src/store/io.mjs';
import { hostStore } from '../src/host/store.mjs';
import { inspectSetup, applySetup, removeSetup } from '../src/host/setup.mjs';
import { renderHooks, setupOwnership } from '../skills/orbit-learn/hosts/setup.mjs';
import * as claudeLine from '../skills/orbit-learn/hosts/claude-statusline.mjs';
import { Refused } from '../src/errors.mjs';
const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const io = realIo();
const rooms = stateRooms(storeBase(process.env));
const root = realpathSync(flag('root') ?? resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const handlers = { inspect: () => inspectSetup(io, flag('target')), render: () => ({ ...inspectSetup(io, flag('target')), entry: renderHooks(flag('host'), root) }), apply: () => applySetup(io, rooms, { target: flag('target'), revision: flag('revision'), key: setupOwnership.key, conflicts: setupOwnership.conflicts, replace: argv.includes('--replace'), entry: renderHooks(flag('host'), root) }), remove: () => removeSetup(io, rooms, flag('target'), flag('revision')), settings };
function settings() {
  const store = hostStore(rooms, io, flag('host'));
  if (flag('revision') === undefined) return store.read();
  return { revision: store.update(JSON.parse(readFileSync(0, 'utf8')), Number(flag('revision'))) };
}
// ---- Orbit Live's status line: --host=claude --kind=statusline ----------------------------------------
const lineTarget = () => claudeLine.target(process.env);
const human = () => {
  if (!argv.includes('--human')) throw new Refused('this writes your own Claude Code settings: it is a person\'s, and says so with --human');
};
const sameEntry = (doc) => JSON.stringify(doc[claudeLine.OWNED_KEY]) === JSON.stringify(claudeLine.entryOf(claudeLine.shimPath(rooms)));
function lineRender() {
  const current = inspectSetup(io, lineTarget());
  const existing = current.document[claudeLine.OWNED_KEY] ?? null;
  return { target: lineTarget(), revision: current.revision, existing, owned: claudeLine.owns(existing, rooms), entry: claudeLine.entryOf(claudeLine.shimPath(rooms)), shim: claudeLine.shimPath(rooms), checks: claudeLine.doctor({ env: process.env, io, base: storeBase(process.env) }) };
}
function lineApply() {
  human();
  const current = inspectSetup(io, lineTarget());
  const shim = claudeLine.installShim(io, rooms);
  if (sameEntry(current.document)) return { unchanged: true, target: lineTarget(), shim };
  return { installed: lineInstalled(current), target: lineTarget(), shim };
}
function lineInstalled(current) {
  if (current.document[claudeLine.OWNED_KEY] && !claudeLine.owns(current.document[claudeLine.OWNED_KEY], rooms) && !argv.includes('--replace') && !argv.includes('--keep-existing')) throw new Refused('you already have a status line: choose --replace (yours comes back on remove) or --keep-existing (yours runs first, then Orbit\'s), or add the shim\'s command to your own script');
  const keep = argv.includes('--keep-existing') ? claudeLine.keptCommand(current.document[claudeLine.OWNED_KEY]) : null;
  const entry = applySetup(io, rooms, { target: lineTarget(), revision: flag('revision'), key: claudeLine.OWNED_KEY, replace: argv.includes('--replace') || keep !== null, entry: claudeLine.entryOf(claudeLine.shimPath(rooms)) });
  if (keep !== null) writeState(io, claudeLine.keepPath(rooms), { command: keep, at: io.now() });
  return entry;
}
function lineRemove() {
  human();
  removeSetup(io, rooms, lineTarget(), flag('revision'));
  io.removeFile(claudeLine.keepPath(rooms));
  return { removed: true, target: lineTarget() };
}
const LINE = { inspect: () => inspectSetup(io, lineTarget()), render: lineRender, apply: lineApply, remove: lineRemove };
const handlerOf = (name) => (flag('kind') === 'statusline' ? (flag('host') === 'claude' ? LINE[name] : null) : handlers[name]);

function main() {
  if (!handlerOf(argv[0]) || !existsSync(join(root, 'cli/learn-hook.mjs'))) throw new Refused('invalid host operation or installation root');
  console.log(JSON.stringify(handlerOf(argv[0])(), null, 2));
}
command(main);
