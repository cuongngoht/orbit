// WHERE THINGS ARE inside an attempt's two containers: fixed by the images (docker/Dockerfile, targets `model-plane` and
// `workstation`) and by the allocator's mount list -- never by a request.
//
//   model plane   /connection   the connection's config home (read-write: the CLI refreshes its own login there);
//                               the runtimes' homes are its subdirectories (claude/, codex/, agy/)
//                 /workdir      an empty working directory for the CLI (tmpfs)
//                 /tmp, /home/orbit   small tmpfs
//                 the runner on port 7070; the Orbit tool bridge at /opt/orbit-web/apps/api/dist/bridge/main.js
//                 NO /etc/claude-code (Claude Code's managed settings): the image has none and nothing mounts one
//   tool plane    /work, /output   the assignment's disk-backed scratch (one quota), /work seeded from the desk
//                 /input        read-only inputs; /home/employee  HOME (scratch, never published)
//                 /cache        the employee's dependency cache (its own quota); /team  the mission's room
//                 /tmp          tmpfs, min(512 MiB, a quarter of the memory limit)
//                 /toolbox      a link to /work/toolbox (the desk's toolbox, inside the work tree)
export const MODEL_PLANE = {
  uid: 10001,
  gid: 10001,
  home: "/connection",
  cwd: "/workdir",
  userHome: "/home/orbit",
  runnerPort: 7070,
  bridgeCommand: { command: "/usr/local/bin/node", args: ["/opt/orbit-web/apps/api/dist/bridge/main.js"] },
  runnerMain: "/opt/orbit-web/apps/api/dist/runner/main.js",
  // Claude Code's managed settings: never in a model plane.
  managedSettings: "/etc/claude-code",
} as const;

// A chat's or a research session's RUN in a sandbox of its own (the Orbit Web image, its runner): Orbit Web's data
// volume is mounted only where that run's own places are, each at the very path Orbit Web uses for it (so the CLI's
// arguments and environment are the same as in Orbit Web's container); `home` (HOME) and /tmp are tmpfs.
export const SESSION_PLANE = {
  uid: 10001,
  gid: 10001,
  dataRoot: "/data",
  home: "/data/home",
  runnerPort: 7070,
  node: "/usr/local/bin/node",
  runnerMain: "/opt/orbit-web/apps/api/dist/runner/main.js",
} as const;

export const TOOL_PLANE = {
  uid: 20001,
  gid: 20001,
  work: "/work",
  output: "/output",
  input: "/input",
  home: "/home/employee",
  cache: "/cache",
  team: "/team",
  tmp: "/tmp",
} as const;

// What every tool-plane program sees, beside the proxy variables of its run.
export const TOOL_PLANE_ENV: Record<string, string> = {
  HOME: TOOL_PLANE.home,
  TMPDIR: TOOL_PLANE.tmp,
  LANG: "C.UTF-8",
  PATH: "/opt/python/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  PIP_CACHE_DIR: `${TOOL_PLANE.cache}/pip`,
  npm_config_cache: `${TOOL_PLANE.cache}/npm`,
  XDG_CACHE_HOME: `${TOOL_PLANE.cache}/xdg`,
  PYTHONDONTWRITEBYTECODE: "1",
};
