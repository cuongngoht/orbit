// ONE CHECKOUT, ONE ID, on every platform (0.0.2): a checkout's id is the hash of its real path, so the real path must
// be one spelling. On Windows the JavaScript realpath keeps an 8.3 short name (C:\Users\RUNNER~1) that git and the
// native call spell long, and a binding written through git was never found again from the shell's directory -- the
// Windows CI's "this directory is not a checkout Orbit has written for".
import { test } from "node:test";
import assert from "node:assert/strict";
import { realpathFor } from "../src/project/boundary.mjs";
import { checkoutId } from "../src/project/repository.mjs";

const SHORT = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\orbit-x\\repo";
const LONG = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\orbit-x\\repo";

// A file system as Windows answers: the JavaScript walk keeps what it was given, the native call names the long path.
const windows = () => {
  const realpathSync = (p) => p;
  realpathSync.native = (p) => p.replace("RUNNER~1", "runneradmin");
  return { realpathSync };
};

test("on Windows the short and the long spelling of one checkout are one real path, and so one checkout id", () => {
  const real = realpathFor("win32", windows());
  assert.equal(real(SHORT), LONG);
  assert.equal(real(LONG), LONG);
  assert.equal(checkoutId(real(SHORT)), checkoutId(real(LONG)));
});

test("a native call that fails falls back to the walk, never to an error", () => {
  const fs = windows();
  fs.realpathSync.native = () => {
    throw new Error("EISDIR on a RAM disk");
  };
  assert.equal(realpathFor("win32", fs)(LONG), LONG);
});

test("anywhere but Windows the realpath every existing id was taken with stands", () => {
  assert.equal(realpathFor("darwin", windows())(SHORT), SHORT);
  assert.equal(realpathFor("linux", windows())(SHORT), SHORT);
});
