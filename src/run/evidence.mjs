// Everything a failure needs, captured without being asked: the screen, the
// console, and THE NETWORK -- the one people forget and the one that usually
// holds the answer. A click that "did nothing" is most often a 403 or 500 the
// UI swallowed, and by the time anyone looks the session is gone. The whole
// request list goes to a file; only the non-2xx lines reach the terminal.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shownPath } from "../shown-path.mjs";
import { summarize } from "../browser/index.mjs";
import { contained } from "../project/boundary.mjs";

// A run that needs no page has no screen, console or browser network to
// capture, and asking a browser anyway is how a FAIL of a backend check turned
// into a BLOCKED about a browser nobody needed. What it has is its log.
export const pagelessEvidence = (out) => ({ pageless: true, shot: null, netFile: null, calls: 0, bad: [], consoleOut: null, url: null, observed: null, outRel: shownPath(out) });

export function captureEvidence(ctx, s, out) {
  const shot = captureScreen(ctx, s, out);
  return { shot, ...network(ctx, out, pad(s)), consoleOut: ctx.browser.console().slice(0, 4000), ...page(ctx), outRel: shownPath(out) };
}

// A verdict that HELD deserves its screen too: a PASS that cannot show what it
// saw is a number, not evidence. The screen ONLY -- the console and the full
// request list are what a failure needs to explain itself, they cost a file
// each, and a step that held has nothing to explain.
export function captureScreen(ctx, s, out) {
  mkdirSync(out, { recursive: true });
  const shot = contained(out, join(out, `step-${pad(s)}.png`));
  ctx.browser.screenshot(shot);
  return shot;
}

const pad = (s) => String(s.i).padStart(2, "0");

function network(ctx, out, nn) {
  const requests = ctx.browser.requests();
  const netFile = contained(out, join(out, `step-${nn}-network.txt`));
  writeFileSync(netFile, requests);
  return { netFile, ...summarize(requests) };
}

function page(ctx) {
  const url = ctx.browser.ev("location.pathname");
  const observed = String(ctx.browser.ev("document.body.innerText.slice(0,600)") ?? "").slice(0, 600);
  return { url, observed };
}
