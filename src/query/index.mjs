// The command table. A command is (ctx, args) => void and prints its own view.
import { listCases, showCase } from "./cases.mjs";
import { check } from "./check.mjs";
import { doctor } from "./doctor.mjs";
import { showDsl, showField, showVerb } from "./dsl.mjs";
import { capabilities, capability, extensions } from "./extensions.mjs";
import { regress, showEffect } from "./effect.mjs";
import { find } from "./find.mjs";
import { flaky, history } from "./history.mjs";
import { showLayers } from "./layers.mjs";
import { notes } from "./notes.mjs";
import { showPath } from "./path.mjs";
import { leadsTo, listScreens, showScreen } from "./screen.mjs";
import { triage } from "./triage.mjs";
import { verify } from "./verify.mjs";
import { storage } from "./storage.mjs";

export const COMMANDS = {
  screen: showScreen, screens: listScreens, to: leadsTo, path: showPath, find,
  layers: showLayers, effect: showEffect, regress,
  cases: listCases, flows: listCases, case: showCase, flow: showCase,
  check, doctor, verify, triage, storage,
  dsl: showDsl, verb: showVerb, field: showField,
  extensions, capabilities, capability,
  history, flaky, notes,
};

export const runQuery = (ctx, cmd, args) => COMMANDS[cmd](ctx, args);
export { checkFindings } from "./check.mjs";
