// What an attempt's containers must look like from OUTSIDE (the runtime's own record of them) and from the kernel's
// view inside (/proc/self/mountinfo): pure checks, each the list of what is wrong (empty: it holds).
import type { ContainerInspect } from "./docker/engine.js";
import type { VolumeMount } from "./specs.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export const check = (name: string, problems: string[], held: string): Check => ({ name, ok: problems.length === 0, detail: problems.length === 0 ? held : problems.join("; ") });

// No privilege, no capability, no way to gain one, a read-only root, the expected user and the one expected network,
// nothing published, no host namespace, no device, no bind of a host path, and no resolver but the runtime's own.
export function hardeningProblems(c: ContainerInspect, user: string, network: string): string[] {
  const h = c.HostConfig;
  const problems: string[] = [];
  if (h.Privileged) problems.push("privileged");
  if (!(h.CapDrop ?? []).map((x) => x.toUpperCase()).includes("ALL")) problems.push("capabilities not dropped");
  if ((h.CapAdd ?? []).length > 0) problems.push(`capabilities added: ${(h.CapAdd ?? []).join(", ")}`);
  if (!(h.SecurityOpt ?? []).some((o) => o === "no-new-privileges" || o === "no-new-privileges:true")) problems.push("no-new-privileges not set");
  if (!h.ReadonlyRootfs) problems.push("the root filesystem is writable");
  if (c.Config.User !== user) problems.push(`runs as ${c.Config.User || "the image's user"}, not ${user}`);
  if (h.NetworkMode !== network) problems.push(`network mode ${h.NetworkMode}, not ${network}`);
  const nets = Object.keys(c.NetworkSettings.Networks ?? {});
  if (nets.length !== 1 || nets[0] !== network) problems.push(`attached to ${nets.join(", ") || "no network"}, not only ${network}`);
  if (h.PortBindings && Object.keys(h.PortBindings).length > 0) problems.push("ports are published");
  if (h.PidMode !== "" && h.PidMode !== "private") problems.push(`PID namespace ${h.PidMode}`);
  if (h.IpcMode !== "private" && h.IpcMode !== "") problems.push(`IPC namespace ${h.IpcMode}`);
  if (h.UsernsMode !== "") problems.push(`user namespace ${h.UsernsMode}`);
  if ((h.Binds ?? []).length > 0) problems.push(`host paths bound: ${(h.Binds ?? []).join(", ")}`);
  if ((h.Devices ?? []).length > 0) problems.push("devices passed in");
  if (JSON.stringify(h.Dns ?? []) !== JSON.stringify(["127.0.0.1"])) problems.push(`resolvers ${JSON.stringify(h.Dns ?? [])} (public names must not resolve)`);
  return problems;
}

// Exactly the expected volume mounts (by volume, destination and access) and tmpfs, and nothing that is the runtime's
// socket. The subpath each mount was asked with is the runtime's record of the request; the kernel's own view of it is
// mountRootProblems below.
export function mountProblems(c: ContainerInspect, expected: VolumeMount[], tmpfs: string[], requested: { Target: string; Source: string; VolumeOptions?: { Subpath?: string } }[]): string[] {
  const problems: string[] = [];
  const have = c.Mounts ?? [];
  for (const e of expected) {
    const m = have.find((x) => x.Destination === e.target);
    if (m === undefined) problems.push(`${e.target} is not mounted`);
    else if (m.Type !== "volume" || m.Name !== e.volume || m.RW === e.readOnly) problems.push(`${e.target} is ${m.Type} ${m.Name ?? m.Source} ${m.RW ? "rw" : "ro"}, not volume ${e.volume} ${e.readOnly ? "ro" : "rw"}`);
    const r = requested.find((x) => x.Target === e.target);
    if ((r?.VolumeOptions?.Subpath ?? null) !== e.subpath) problems.push(`${e.target} was asked for subpath ${r?.VolumeOptions?.Subpath ?? "none"}, not ${e.subpath ?? "none"}`);
  }
  for (const m of have) if (!expected.some((e) => e.target === m.Destination)) problems.push(`an unexpected mount at ${m.Destination} (${m.Type} ${m.Name ?? m.Source})`);
  for (const m of have) if (/docker\.sock|containerd\.sock|podman\.sock/.test(`${m.Source} ${m.Destination}`)) problems.push(`a container runtime's socket is mounted (${m.Source})`);
  const t = Object.keys(c.HostConfig.Tmpfs ?? {}).sort();
  if (JSON.stringify(t) !== JSON.stringify([...tmpfs].sort())) problems.push(`tmpfs at ${t.join(", ") || "nothing"}, not ${[...tmpfs].sort().join(", ")}`);
  return problems;
}

export interface MountInfoLine {
  root: string;
  mountPoint: string;
  options: string;
}

// /proc/self/mountinfo: "id parent major:minor root mount-point options ... - type source super-options".
export function parseMountInfo(text: string): MountInfoLine[] {
  return text
    .split("\n")
    .map((l) => l.split(" "))
    .filter((f) => f.length > 6)
    .map((f) => ({ root: unescapeMount(f[3] as string), mountPoint: unescapeMount(f[4] as string), options: f[5] as string }));
}

const unescapeMount = (s: string): string => s.replace(/\\([0-7]{3})/g, (_m, o: string) => String.fromCharCode(parseInt(o, 8)));

// The kernel's word for what each mount point holds: the root of the expected one ends with its subpath (on a pool the
// root is the path inside the pool; on the host's filesystem, the volume's directory and then the subpath).
export function mountRootProblems(lines: MountInfoLine[], expected: VolumeMount[]): string[] {
  const problems: string[] = [];
  for (const e of expected) {
    const line = [...lines].reverse().find((l) => l.mountPoint === e.target);
    if (line === undefined) {
      problems.push(`${e.target} is not a mount point inside the container`);
      continue;
    }
    if (e.subpath !== null && !(line.root === `/${e.subpath}` || line.root.endsWith(`/${e.subpath}`))) problems.push(`${e.target} holds ${line.root}, not ${e.subpath}`);
    const ro = line.options.split(",").includes("ro");
    if (ro !== e.readOnly) problems.push(`${e.target} is ${ro ? "read-only" : "writable"} inside, not ${e.readOnly ? "read-only" : "writable"}`);
  }
  for (const l of lines) if (/docker\.sock|containerd\.sock/.test(l.mountPoint) || /docker\.sock|containerd\.sock/.test(l.root)) problems.push(`a runtime socket is mounted at ${l.mountPoint}`);
  return problems;
}
