// The REAL effects behind the tools layer that the profile work added (src/tools/real.mjs, src/store/io.mjs): run for real
// on whatever machine runs the suite -- a scratch directory only the user can enter, a probe that is handed an environment
// and a directory, the first bytes of a file, where WSL would mount Windows' drives, the reader of the plugin's locks, and
// the removal of an install that was never finished. The suites above fake each of these; this one holds the fakes honest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Refused } from "../src/errors.mjs";
import { realIo } from "../src/store/io.mjs";
import { realDetection, realInstallIo, realLockFile } from "../src/tools/real.mjs";

const scratchDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-real-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("a scratch directory is made for one question: only this user can enter it, and it goes away when the question is answered", () => {
  const scratch = realDetection({}).scratch();
  assert.equal(existsSync(scratch.dir), true);
  if (process.platform !== "win32") assert.equal(statSync(scratch.dir).mode & 0o777, 0o700, "mkdtemp's own mode: nobody else can write there");
  scratch.dispose();
  assert.equal(existsSync(scratch.dir), false);
  scratch.dispose();
});

test("a probe asked with an environment gets EXACTLY that environment; asked with a directory it runs there; asked with neither it runs as it always did", (t) => {
  const here = scratchDir(t);
  const { run } = realDetection({ PATH: process.env.PATH });
  const ask = (code, options) => run(process.execPath, ["-e", code], options);
  assert.equal(ask("process.stdout.write(String(process.env.ORBIT_PROBE_VALUE))", { env: { ORBIT_PROBE_VALUE: "given", PATH: process.env.PATH } }).stdout, "given");
  assert.equal(ask("process.stdout.write(String(process.env.HOME))", { env: { PATH: process.env.PATH } }).stdout, "undefined", "nothing is inherited that was not named");
  assert.equal(realpathSync(ask("process.stdout.write(process.cwd())", { cwd: here }).stdout), realpathSync(here));
  assert.notEqual(realpathSync(ask("process.stdout.write(process.cwd())").stdout), realpathSync(process.cwd()), "never the checkout the process was started in");
  const slow = ask("setTimeout(() => {}, 5000)", { timeoutMs: 300 });
  assert.equal(slow.error?.code, "ETIMEDOUT", "the row's own deadline is honoured");
});

test("the first bytes of a file say what kind of program it is; a file that cannot be read says nothing at all", (t) => {
  const dir = scratchDir(t);
  const { head } = realDetection({});
  writeFileSync(join(dir, "windows.exe"), Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]));
  writeFileSync(join(dir, "script"), "#!/bin/sh\necho hi\n");
  assert.deepEqual([head(join(dir, "windows.exe"), 2), head(join(dir, "script"), 2), head(join(dir, "missing"), 2), head(dir, 2)], ["MZ", "#!", null, null]);
});

test("Windows' drives are only ever looked for under WSL -- and only on Linux, whatever the environment says", () => {
  const under = realDetection({ WSL_DISTRO_NAME: "Ubuntu" }).windowsMounts;
  assert.deepEqual(under, process.platform === "linux" ? ["/mnt/"] : []);
});

test("a lock is read from the plugin's own catalog directory, and a path that leaves it is refused", (t) => {
  const plugin = scratchDir(t);
  mkdirSync(join(plugin, "catalog", "locks"), { recursive: true });
  writeFileSync(join(plugin, "catalog", "locks", "x.lock"), "pkg==1.0.0 --hash=sha256:" + "a".repeat(64) + "\n");
  writeFileSync(join(plugin, "secret.txt"), "not a lock");
  const read = realLockFile(plugin);
  assert.deepEqual([read("locks/x.lock").path, read("locks/x.lock").text.startsWith("pkg==1.0.0")], [join(plugin, "catalog", "locks", "x.lock"), true]);
  assert.throws(() => read("../secret.txt"), Refused);
  assert.throws(() => read("../../etc/passwd"), Refused);
});

test("an install that was never finished is removed under the tool's lock; anything else beside it is left exactly as it was", (t) => {
  const tool = join(scratchDir(t), "runtimes", "tools", "x");
  mkdirSync(join(tool, ".install-ABANDONED", "deep"), { recursive: true });
  writeFileSync(join(tool, ".install-ABANDONED", "deep", "half"), "x");
  mkdirSync(join(tool, "1.0.0-linux-x64"), { recursive: true });
  mkdirSync(join(tool, "1.0.0-linux-x64.replaced-123"), { recursive: true });
  const io = realInstallIo();
  io.sweepStaging(tool);
  io.sweepStaging(join(tool, "no-such-tool"));
  assert.deepEqual([existsSync(join(tool, ".install-ABANDONED")), existsSync(join(tool, "1.0.0-linux-x64")), existsSync(join(tool, "1.0.0-linux-x64.replaced-123"))], [false, true, true]);
});

test("a directory only this user may enter is made on demand, with every missing parent, and again without complaint", (t) => {
  const dir = join(scratchDir(t), "control", "auth", "profile");
  const io = realIo();
  assert.equal(io.ensurePrivateDir(dir), dir);
  assert.equal(io.ensurePrivateDir(dir), dir);
  if (process.platform !== "win32") assert.equal(statSync(dir).mode & 0o777, 0o700);
});
