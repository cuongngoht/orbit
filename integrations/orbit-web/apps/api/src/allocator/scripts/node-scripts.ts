// PROGRAMS THE ALLOCATOR RUNS INSIDE A CONTAINER, with `node -e`: each is a function whose own SOURCE is sent (it uses
// nothing but its body, `process` and the built-in modules it asks for), so it is type-checked and linted here like any
// other code, and runs as the container's own user -- an employee's programs only ever see what that container mounts.
// Arguments arrive in process.argv (after `node -e <source>`, argv[1] is the first). Exit codes say what happened:
//   0 done · 3 not found · 4 outside the allowed places (or through a link) · 5 too large · 6 wrong kind · 7 out of quota
// Node names "Disk quota exceeded" UNKNOWN (libuv has no name for errno 122): each program says EDQUOT for it.
export const nodeScript = (fn: () => void): string => `(${fn.toString()})();`;

// read <path> <maxBytes> | write <path> (bytes on stdin) | list <path> <maxEntries>   -- in a TOOL PLANE, as the employee.
export function toolFileScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const [op, target, limitRaw] = process.argv.slice(1);
  const limit = Number(limitRaw ?? "0");
  const ROOTS = ["/work", "/output", "/team"];
  const die = (code: number, message: string): never => {
    process.stderr.write(message);
    process.exit(code);
  };
  const errCode = (e: unknown): string => ((e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)));
  const real = (p: string): string | null => {
    try {
      return fs.realpathSync(p);
    } catch (e) {
      if (errCode(e) === "ENOENT" || errCode(e) === "ENOTDIR") return null;
      return die(1, errCode(e));
    }
  };
  const rootOf = (abs: string): string | null => {
    for (const r of ROOTS) {
      const rr = real(r);
      if (rr !== null && (abs === rr || abs.startsWith(`${rr}/`))) return rr;
    }
    return null;
  };
  if (typeof target !== "string") die(2, "no path");
  const t = target as string;
  if (op === "read") {
    const r = real(t);
    if (r === null) die(3, "not found");
    if (rootOf(r as string) === null) die(4, "the path leads out of the workspace through a link");
    const st = fs.statSync(r as string);
    if (!st.isFile()) die(6, "not a file");
    if (st.size > limit) die(5, String(st.size));
    const fd = fs.openSync(r as string, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const data = fs.readFileSync(fd);
    fs.closeSync(fd);
    if (data.length > limit) die(5, String(data.length));
    process.stdout.write(data);
    return;
  }
  if (op === "write") {
    const root = ROOTS.find((r) => t.startsWith(`${r}/`));
    if (root === undefined) die(4, "not a file inside /work, /output or /team");
    let dir = root as string;
    for (const seg of path.relative(root as string, path.dirname(t)).split("/").filter((s) => s.length > 0)) {
      dir = path.join(dir, seg);
      let st: import("node:fs").Stats | null = null;
      try {
        st = fs.lstatSync(dir);
      } catch (e) {
        if (errCode(e) !== "ENOENT") die(1, errCode(e));
      }
      if (st === null) fs.mkdirSync(dir, { mode: 0o755 });
      else if (st.isSymbolicLink()) {
        const rr = real(dir);
        if (rr === null || rootOf(rr) === null || !fs.statSync(rr).isDirectory()) die(4, "a directory of the path is a link out of the workspace");
      } else if (!st.isDirectory()) die(6, "a part of the path is not a directory");
    }
    const realDir = real(path.dirname(t));
    if (realDir === null || rootOf(realDir) === null) die(4, "the directory leads out of the workspace");
    const final = path.join(realDir as string, path.basename(t));
    try {
      const st = fs.lstatSync(final);
      if (st.isSymbolicLink()) die(4, "the file is a link");
      if (st.isDirectory()) die(6, "a directory is in the way");
    } catch (e) {
      if (errCode(e) !== "ENOENT") die(1, errCode(e));
    }
    const bytes = fs.readFileSync(0);
    const tmp = path.join(realDir as string, `.orbit-write-${process.pid}-${Date.now()}`);
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o644);
    try {
      fs.writeSync(fd, bytes);
      fs.fsyncSync(fd);
    } catch (e) {
      fs.closeSync(fd);
      fs.rmSync(tmp, { force: true });
      die(errCode(e) === "EDQUOT" || errCode(e) === "ENOSPC" ? 7 : 1, errCode(e));
    }
    fs.closeSync(fd);
    fs.renameSync(tmp, final);
    return;
  }
  if (op === "list") {
    const r = real(t);
    if (r === null) die(3, "not found");
    const root = rootOf(r as string);
    if (root === null) die(4, "the path leads out of the workspace through a link");
    if (!fs.statSync(r as string).isDirectory()) die(6, "not a directory");
    const names = fs.readdirSync(r as string).sort();
    const entries: { path: string; type: string; size: number }[] = [];
    for (const name of names) {
      if (entries.length >= limit) break;
      const p = path.join(r as string, name);
      let st: import("node:fs").Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      entries.push({ path: path.relative(root as string, p), type: st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "dir" : st.isFile() ? "file" : "other", size: st.isFile() ? st.size : 0 });
    }
    process.stdout.write(JSON.stringify({ entries, more: names.length > entries.length }));
    return;
  }
  die(2, "unknown operation");
}

export interface AttestProbeConfig {
  absent: { name: string; path: string }[];
  canaries: { name: string; nonce: string; paths: string[] }[];
  closed: { name: string; host: string; port: number; what: string }[];
  dnsName: string;
  tmp: { path: string; limitBytes: number };
}

// The tool plane's own view, asked as the employee before anything of the employee ran: what must not be there, what it
// must not reach, and whether /tmp refuses a write past its size.
export function attestProbeScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const net = process.getBuiltinModule("node:net");
  const dns = process.getBuiltinModule("node:dns");
  const cfg = JSON.parse(process.argv[1] ?? "{}") as AttestProbeConfig;
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  const errCode = (e: unknown): string => ((e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)));
  for (const a of cfg.absent) {
    try {
      fs.lstatSync(a.path);
      add(a.name, false, `${a.path} EXISTS in the tool plane`);
    } catch (e) {
      add(a.name, errCode(e) === "ENOENT", errCode(e) === "ENOENT" ? `${a.path} is not in the tool plane` : `${a.path} could not be told apart (${errCode(e)})`);
    }
  }
  for (const c of cfg.canaries) {
    const seen: string[] = [];
    for (const p of c.paths) {
      try {
        fs.lstatSync(p);
        seen.push(p);
      } catch {
        // absent, as it must be
      }
    }
    add(c.name, seen.length === 0, seen.length === 0 ? `the marker is in none of the ${c.paths.length} places it would appear` : `the marker is VISIBLE at ${seen.join(", ")}`);
  }
  let written = 0;
  let refused: string | null = null;
  try {
    const fd = fs.openSync(cfg.tmp.path, "wx", 0o600);
    const chunk = Buffer.alloc(1024 * 1024);
    try {
      while (written <= cfg.tmp.limitBytes + chunk.length) written += fs.writeSync(fd, chunk);
    } catch (e) {
      refused = errCode(e);
    }
    fs.closeSync(fd);
  } catch (e) {
    refused = refused ?? errCode(e);
  }
  try {
    fs.unlinkSync(cfg.tmp.path);
  } catch {
    // nothing written
  }
  const tmpHeld = refused === "ENOSPC" && written <= cfg.tmp.limitBytes;
  add("tmp_quota", tmpHeld, tmpHeld ? `/tmp refused a write at ${written} bytes (ENOSPC), within its ${cfg.tmp.limitBytes}-byte size` : `/tmp took ${written} bytes (${refused ?? "no refusal"}) against a ${cfg.tmp.limitBytes}-byte size`);
  const connect = (host: string, port: number): Promise<string> =>
    new Promise((resolve) => {
      const s = net.connect({ host, port });
      const timer = setTimeout(() => {
        s.destroy();
        resolve("timed out");
      }, 3000);
      s.on("connect", () => {
        clearTimeout(timer);
        s.destroy();
        resolve("connected");
      });
      s.on("error", (e) => {
        clearTimeout(timer);
        resolve(errCode(e));
      });
    });
  const run = async (): Promise<void> => {
    for (const c of cfg.closed) {
      const r = await connect(c.host, c.port);
      add(c.name, r !== "connected", r === "connected" ? `${c.what} at ${c.host}:${c.port} ACCEPTED a connection from the tool plane` : `${c.what} (${c.host}:${c.port}) cannot be reached from the tool plane (${r})`);
    }
    try {
      const a = await dns.promises.lookup(cfg.dnsName);
      add("public_dns", false, `${cfg.dnsName} RESOLVED to ${a.address} from the tool plane: names are a channel out`);
    } catch (e) {
      add("public_dns", true, `public names do not resolve in the tool plane (${errCode(e)})`);
    }
    process.stdout.write(JSON.stringify({ checks, uid: process.getuid?.() ?? null, written }));
  };
  void run();
}

// The container's own cgroup, read from the kernel's files (v1 or v2): limits, use, peaks, OOM kills.
export function cgroupScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const read = (p: string): string | null => {
    try {
      return fs.readFileSync(p, "utf8").trim();
    } catch {
      return null;
    }
  };
  const v2 = fs.existsSync("/sys/fs/cgroup/cgroup.controllers");
  const files: Record<string, string | null> = {};
  if (v2) {
    for (const f of ["memory.max", "memory.current", "memory.peak", "memory.events", "memory.swap.max", "cpu.max", "cpu.stat", "pids.max", "pids.current", "pids.peak"]) files[f] = read(`/sys/fs/cgroup/${f}`);
  } else {
    for (const f of ["memory.limit_in_bytes", "memory.usage_in_bytes", "memory.max_usage_in_bytes", "memory.oom_control", "memory.memsw.limit_in_bytes", "memory.stat"]) files[f] = read(`/sys/fs/cgroup/memory/${f}`);
    for (const f of ["cpu.cfs_quota_us", "cpu.cfs_period_us"]) files[f] = read(`/sys/fs/cgroup/cpu/${f}`) ?? read(`/sys/fs/cgroup/cpu,cpuacct/${f}`);
    files["cpuacct.usage"] = read("/sys/fs/cgroup/cpuacct/cpuacct.usage") ?? read("/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage");
    for (const f of ["pids.max", "pids.current"]) files[f] = read(`/sys/fs/cgroup/pids/${f}`);
  }
  process.stdout.write(JSON.stringify({ version: v2 ? "v2" : "v1", files }));
}

// <target> <maxBytes>: write zeros until the kernel refuses (or maxBytes), then remove the file.
export function writeProbeScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const [target, maxRaw] = process.argv.slice(1);
  const max = Number(maxRaw);
  const errCode = (e: unknown): string => ((e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)));
  let written = 0;
  let code: string | null = null;
  const fd = fs.openSync(target as string, "w", 0o600);
  const chunk = Buffer.alloc(1024 * 1024);
  try {
    while (written < max) written += fs.writeSync(fd, chunk);
    fs.fsyncSync(fd);
  } catch (e) {
    code = errCode(e);
  }
  fs.closeSync(fd);
  try {
    fs.unlinkSync(target as string);
  } catch {
    // gone already
  }
  process.stdout.write(JSON.stringify({ written, code }));
}

// <dir>...: in each, a new 1 MiB file written, flushed, read back and removed -- a sandbox is READY only after this.
export function writeTestScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const crypto = process.getBuiltinModule("node:crypto");
  const results = process.argv.slice(1).map((dir) => {
    const p = `${dir}/.orbit-write-test-${crypto.randomBytes(6).toString("hex")}`;
    try {
      const data = crypto.randomBytes(1024 * 1024);
      const fd = fs.openSync(p, "wx", 0o600);
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      const back = fs.readFileSync(p);
      fs.unlinkSync(p);
      return { dir, ok: back.equals(data), code: null as string | null };
    } catch (e) {
      fs.rmSync(p, { force: true });
      return { dir, ok: false, code: (e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)) };
    }
  });
  process.stdout.write(JSON.stringify(results));
}

// seed <src> <dst> | publish <src> <dst> | inputs <dst> (JSON on stdin) -- in a storage worker that mounts exactly these
// places of ONE employee, as that employee: a link in either tree is copied as a link, never followed. The work tree's
// `.orbit/` (the handoff protocol's own files) is never carried to the desk.
export function syncScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const crypto = process.getBuiltinModule("node:crypto");
  const [mode, a, b] = process.argv.slice(1);
  const STAGE = ".orbit-publish";
  const SKIP = new Set([".orbit", STAGE, "lost+found"]);
  // The marker an isolation check plants in ANOTHER employee's desk for a moment: never seeded into a work tree, never
  // published over (the check would find it gone), and never taken from a work tree -- so no employee can put a file the
  // desk's review never shows (deskScript) into its desk.
  const CANARY = /^\.orbit-canary-[0-9a-f]+$/;
  const errCode = (e: unknown): string => ((e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)));
  type Entry = { type: "file" | "dir" | "link"; size: number; mtimeMs: number; mode: number; target: string };
  const walk = (root: string): Map<string, Entry> => {
    const out = new Map<string, Entry>();
    const visit = (rel: string): void => {
      const abs = rel === "" ? root : path.join(root, rel);
      for (const name of fs.readdirSync(abs).sort()) {
        if (rel === "" && (SKIP.has(name) || CANARY.test(name))) continue;
        const r = rel === "" ? name : `${rel}/${name}`;
        const st = fs.lstatSync(path.join(abs, name));
        if (st.isSymbolicLink()) out.set(r, { type: "link", size: 0, mtimeMs: 0, mode: 0, target: fs.readlinkSync(path.join(abs, name)) });
        else if (st.isDirectory()) {
          out.set(r, { type: "dir", size: 0, mtimeMs: 0, mode: st.mode & 0o777, target: "" });
          visit(r);
        } else if (st.isFile()) out.set(r, { type: "file", size: st.size, mtimeMs: st.mtimeMs, mode: st.mode & 0o777, target: "" });
      }
    };
    visit("");
    return out;
  };
  const hash = (p: string): string => {
    const h = crypto.createHash("sha256");
    const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const buf = Buffer.alloc(1024 * 1024);
    for (let n = fs.readSync(fd, buf); n > 0; n = fs.readSync(fd, buf)) h.update(buf.subarray(0, n));
    fs.closeSync(fd);
    return h.digest("hex");
  };
  const copyFile = (from: string, to: string, e: Entry): void => {
    fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(to, e.mode);
    fs.utimesSync(to, new Date(e.mtimeMs), new Date(e.mtimeMs));
  };
  const finish = (result: unknown, code = 0): void => {
    process.stdout.write(JSON.stringify(result));
    process.exitCode = code;
  };
  if (mode === "seed") {
    const src = a as string;
    const dst = b as string;
    if (fs.readdirSync(dst).filter((n) => !SKIP.has(n)).length > 0) return finish({ seeded: false, reason: "the work tree is not empty" });
    const entries = walk(src);
    try {
      for (const [rel, e] of entries) {
        const to = path.join(dst, rel);
        if (e.type === "dir") fs.mkdirSync(to, { mode: e.mode | 0o700 });
        else if (e.type === "link") fs.symlinkSync(e.target, to);
        else copyFile(path.join(src, rel), to, e);
      }
    } catch (err) {
      return finish({ seeded: false, reason: errCode(err) }, errCode(err) === "EDQUOT" || errCode(err) === "ENOSPC" ? 7 : 1);
    }
    return finish({ seeded: true, entries: entries.size });
  }
  if (mode === "publish") {
    const src = a as string;
    const dst = b as string;
    const stage = path.join(dst, STAGE);
    fs.rmSync(stage, { recursive: true, force: true });
    const from = walk(src);
    const to = walk(dst);
    const same = (rel: string, x: Entry, y: Entry | undefined): boolean => {
      if (y === undefined || x.type !== y.type) return false;
      if (x.type === "link") return x.target === y.target;
      if (x.type === "dir") return true;
      if (x.size !== y.size || x.mode !== y.mode) return false;
      return x.mtimeMs === y.mtimeMs || hash(path.join(src, rel)) === hash(path.join(dst, rel));
    };
    const changed = [...from].filter(([rel, e]) => !same(rel, e, to.get(rel))).map(([rel]) => rel);
    const removed = [...to.keys()].filter((rel) => !from.has(rel));
    // Phase 1: every new or changed file's bytes into the staging directory -- refused by the desk's quota here, the
    // desk is left as it was.
    const staged = new Map<string, string>();
    try {
      fs.mkdirSync(stage, { mode: 0o700 });
      let n = 0;
      for (const rel of changed) {
        const e = from.get(rel) as Entry;
        if (e.type !== "file") continue;
        const tmp = path.join(stage, String(n++));
        copyFile(path.join(src, rel), tmp, e);
        staged.set(rel, tmp);
      }
    } catch (err) {
      fs.rmSync(stage, { recursive: true, force: true });
      const quota = errCode(err) === "EDQUOT" || errCode(err) === "ENOSPC";
      return finish({ published: false, reason: quota ? "the desk's quota cannot hold the work tree" : errCode(err) }, quota ? 7 : 1);
    }
    // Phase 2: what went away or changed its kind, deepest first; then directories, files and links into place.
    const gone = [...removed, ...changed.filter((rel) => to.has(rel) && (to.get(rel) as Entry).type !== (from.get(rel) as Entry).type)];
    for (const rel of gone.sort((x, y) => y.length - x.length)) fs.rmSync(path.join(dst, rel), { recursive: true, force: true });
    for (const rel of changed.filter((r) => (from.get(r) as Entry).type === "dir").sort((x, y) => x.length - y.length)) fs.mkdirSync(path.join(dst, rel), { recursive: true, mode: 0o755 });
    for (const rel of changed) {
      const e = from.get(rel) as Entry;
      const target = path.join(dst, rel);
      if (e.type === "file") fs.renameSync(staged.get(rel) as string, target);
      if (e.type === "link") {
        fs.rmSync(target, { force: true });
        fs.symlinkSync(e.target, target);
      }
    }
    fs.rmSync(stage, { recursive: true, force: true });
    return finish({ published: true, changed: [...changed, ...removed].sort() });
  }
  if (mode === "inputs") {
    const dst = a as string;
    const inputs = JSON.parse(fs.readFileSync(0, "utf8")) as { name: string; base64: string }[];
    for (const name of fs.readdirSync(dst)) fs.rmSync(path.join(dst, name), { recursive: true, force: true });
    for (const i of inputs) {
      const p = path.join(dst, path.basename(i.name));
      fs.writeFileSync(p, Buffer.from(i.base64, "base64"), { flag: "wx", mode: 0o444 });
    }
    return finish({ inputs: inputs.length });
  }
  finish({ error: "unknown mode" }, 2);
}

// list <desk> <dir> <maxEntries> | read <desk> <path> <maxBytes> | clean <desk> <cache> (what to remove as JSON on stdin)
// -- a person looking into ONE employee's desk, or cleaning it up, in a storage worker that mounts that desk (read only
// but for a clean) and, for a clean, its cache, as that employee. Nothing is followed: a path with a link among its
// folders is refused, a link is listed with its target and removed as a link. Orbit Web's own names at the desk's top
// (the publishing's stage, lost+found, an isolation check's marker) are never shown, read or removed, and a clean keeps
// the toolbox's folders. A clean looks at every path it names before it removes anything.
//   2 not a path in the desk (or a kept one) · 3 not found · 4 through a link · 6 not a folder / not a file
export function deskScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const [op, root, arg, limitRaw] = process.argv.slice(1);
  const desk = root as string;
  const limit = Number(limitRaw ?? "0");
  const RESERVED = new Set([".orbit", ".orbit-publish", "lost+found"]);
  const CANARY = /^\.orbit-canary-[0-9a-f]+$/;
  const KEPT = new Set(["toolbox", "toolbox/skills", "toolbox/scripts"]);
  // eslint-disable-next-line no-control-regex -- control characters are what is refused
  const CONTROL = /[\u0000-\u001f\u007f]/;
  const reserved = (name: string): boolean => RESERVED.has(name) || CANARY.test(name);
  const die = (code: number, message: string): never => {
    process.stderr.write(message);
    process.exit(code);
  };
  const errCode = (e: unknown): string => ((e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)));
  const out = (v: unknown): void => {
    process.stdout.write(JSON.stringify(v));
  };
  const iso = (ms: number): string => new Date(ms).toISOString();
  // A path in the desk from its root: relative, plain, never one of Orbit Web's own names at the top.
  const segmentsOf = (p: string, rootAllowed: boolean): string[] => {
    if (p === "") return rootAllowed ? [] : die(2, "no path");
    const segs = p.split("/");
    if (p.length > 1024 || CONTROL.test(p) || segs.some((s) => s === "" || s === "." || s === "..") || reserved(segs[0] as string)) die(2, `not a path in the desk: ${JSON.stringify(p).slice(0, 200)}`);
    return segs;
  };
  // Each folder on the way, looked at itself: a link refuses; a missing one is not found (null, when that is asked).
  const folderOf = (segs: string[], missingOk = false): string | null => {
    let dir = desk;
    for (const seg of segs) {
      dir = path.join(dir, seg);
      let st: import("node:fs").Stats;
      try {
        st = fs.lstatSync(dir);
      } catch (e) {
        if (errCode(e) === "ENOENT" && missingOk) return null;
        return errCode(e) === "ENOENT" ? die(3, "not found") : die(1, errCode(e));
      }
      if (st.isSymbolicLink()) die(4, "a folder of the path is a link");
      if (!st.isDirectory()) die(6, "a part of the path is not a folder");
    }
    return dir;
  };
  const child = (dir: Buffer | string, name: Buffer): Buffer => Buffer.concat([Buffer.from(dir), Buffer.from("/"), name]);
  // What everything under a folder holds, walked without following a link (an unreadable folder counts as empty).
  const under = (dir: Buffer): { bytes: number; files: number } => {
    let bytes = 0;
    let files = 0;
    const stack: Buffer[] = [dir];
    for (let d = stack.pop(); d !== undefined; d = stack.pop()) {
      let names: Buffer[] = [];
      try {
        names = fs.readdirSync(d, { encoding: "buffer" });
      } catch {
        continue;
      }
      for (const n of names) {
        const p = child(d, n);
        let st: import("node:fs").Stats;
        try {
          st = fs.lstatSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) stack.push(p);
        else if (st.isFile()) {
          bytes += st.size;
          files += 1;
        }
      }
    }
    return { bytes, files };
  };

  if (op === "list") {
    const segs = segmentsOf(arg ?? "", true);
    const dir = folderOf(segs) as string;
    const top = segs.length === 0;
    type Entry = { name: string; path: string | null; type: string; bytes: number; files: number; modifiedAt: string; target: string | null };
    const entries: Entry[] = [];
    for (const n of fs.readdirSync(dir, { encoding: "buffer" })) {
      const name = n.toString("utf8");
      if (top && reserved(name)) continue;
      const p = child(dir, n);
      let st: import("node:fs").Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        continue;
      }
      // A name that is not UTF-8 (or holds a control character) is shown; only "empty" can remove it.
      const plain = Buffer.from(name, "utf8").equals(n) && !CONTROL.test(name);
      const e: Entry = { name, path: plain ? [...segs, name].join("/") : null, type: "other", bytes: 0, files: 0, modifiedAt: iso(st.mtimeMs), target: null };
      if (st.isSymbolicLink()) Object.assign(e, { type: "link", target: fs.readlinkSync(p).toString() });
      else if (st.isDirectory()) Object.assign(e, { type: "dir" }, under(p));
      else if (st.isFile()) Object.assign(e, { type: "file", bytes: st.size, files: 1 });
      entries.push(e);
    }
    entries.sort((x, y) => y.bytes - x.bytes || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
    const max = Number.isInteger(limit) && limit > 0 ? limit : 2000;
    return out({ entries: entries.slice(0, max), truncated: entries.length > max, bytes: entries.reduce((s, e) => s + e.bytes, 0), files: entries.reduce((s, e) => s + e.files, 0) });
  }

  if (op === "read") {
    const segs = segmentsOf(arg ?? "", false);
    const file = path.join(folderOf(segs.slice(0, -1)) as string, segs[segs.length - 1] as string);
    let st: import("node:fs").Stats;
    try {
      st = fs.lstatSync(file);
    } catch (e) {
      return errCode(e) === "ENOENT" ? die(3, "not found") : die(1, errCode(e));
    }
    if (st.isSymbolicLink()) die(4, "the file is a link");
    if (!st.isFile()) die(6, "not a file");
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.max(0, Math.min(size, limit)));
    let n = 0;
    while (n < buf.length) {
      const r = fs.readSync(fd, buf, n, buf.length - n, n);
      if (r === 0) break;
      n += r;
    }
    fs.closeSync(fd);
    return out({ bytes: size, base64: buf.subarray(0, n).toString("base64"), truncated: size > n, modifiedAt: iso(st.mtimeMs) });
  }

  if (op === "clean") {
    const req = JSON.parse(fs.readFileSync(0, "utf8") || "{}") as { remove?: unknown; empty?: unknown; cache?: unknown };
    const cache = arg ?? "";
    const named = Array.isArray(req.remove) ? req.remove : [];
    // Every named path first: one through a link, or one that may not be removed, refuses the whole clean.
    const exists = (p: Buffer): boolean => {
      try {
        fs.lstatSync(p);
        return true;
      } catch (e) {
        return errCode(e) === "ENOENT" ? false : die(1, errCode(e));
      }
    };
    const targets: { rel: string; abs: Buffer }[] = [];
    const missing: string[] = [];
    for (const rel of named) {
      if (typeof rel !== "string") die(2, "a path must be text");
      const segs = segmentsOf(rel as string, false);
      if (KEPT.has(rel as string)) die(2, `${rel as string} is kept`);
      const dir = folderOf(segs.slice(0, -1), true);
      const abs = dir === null ? null : Buffer.from(path.join(dir, segs[segs.length - 1] as string));
      if (abs !== null && exists(abs)) targets.push({ rel: rel as string, abs });
      else missing.push(rel as string);
    }
    let removed = 0;
    // A folder is opened up for its owner (a read-only one too) and emptied; a link goes as a link; nothing is followed.
    const rm = (abs: Buffer): void => {
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) {
        if ((st.mode & 0o700) !== 0o700) fs.chmodSync(abs, (st.mode & 0o7777) | 0o700);
        for (const n of fs.readdirSync(abs, { encoding: "buffer" })) rm(child(abs, n));
        fs.rmdirSync(abs);
      } else fs.unlinkSync(abs);
      removed += 1;
    };
    // Removing an entry asks its folder to be writable: a read-only one is opened for that and closed again.
    const remove = (abs: Buffer): void => {
      const parent = abs.subarray(0, abs.lastIndexOf(0x2f));
      const mode = fs.statSync(parent).mode & 0o7777;
      if ((mode & 0o300) !== 0o300) fs.chmodSync(parent, mode | 0o300);
      try {
        rm(abs);
      } finally {
        if ((mode & 0o300) !== 0o300) fs.chmodSync(parent, mode);
      }
    };
    const paths: string[] = [];
    try {
      for (const t of targets) {
        remove(t.abs);
        paths.push(t.rel);
      }
      if (req.empty === true)
        for (const n of fs.readdirSync(desk, { encoding: "buffer" })) {
          const name = n.toString("utf8");
          if (reserved(name) || n.equals(Buffer.from("toolbox"))) continue;
          remove(child(desk, n));
          paths.push(name);
        }
      if (req.cache === true && cache !== "")
        for (const n of fs.readdirSync(cache, { encoding: "buffer" })) if (!n.equals(Buffer.from("lost+found"))) remove(child(cache, n));
    } catch (e) {
      return die(1, `${errCode(e)} after ${removed} removed`);
    }
    return out({ removed, paths: paths.slice(0, 50), missing, cacheEmptied: req.cache === true && cache !== "" });
  }
  die(2, "unknown operation");
}

// plant <path> <nonce> | unplant <path> | absent <path> | ready <port>  -- in a MODEL PLANE, as its user.
export function modelPlaneScript(): void {
  const fs = process.getBuiltinModule("node:fs");
  const net = process.getBuiltinModule("node:net");
  const [op, arg, nonce] = process.argv.slice(1);
  const errCode = (e: unknown): string => ((e as { errno?: number }).errno === -122 ? "EDQUOT" : ((e as { code?: string }).code ?? String(e)));
  if (op === "plant") {
    fs.writeFileSync(arg as string, nonce as string, { flag: "wx", mode: 0o644 });
    fs.chmodSync(arg as string, 0o644);
    return;
  }
  if (op === "unplant") {
    fs.rmSync(arg as string, { force: true });
    return;
  }
  if (op === "absent") {
    try {
      fs.lstatSync(arg as string);
      process.stdout.write(JSON.stringify({ absent: false, code: null }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ absent: errCode(e) === "ENOENT", code: errCode(e) }));
    }
    return;
  }
  if (op === "ready") {
    const s = net.connect({ host: "127.0.0.1", port: Number(arg) });
    s.on("connect", () => {
      s.destroy();
      process.exitCode = 0;
    });
    s.on("error", () => {
      process.exitCode = 1;
    });
    return;
  }
  process.exitCode = 2;
}
