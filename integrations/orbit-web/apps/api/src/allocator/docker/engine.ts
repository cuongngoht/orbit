// THE CONTAINER RUNTIME, spoken to directly: Docker's Engine API over its unix socket, with node:http and nothing else
// (no client library). Only the allocator holds the socket; this class is its only way to it. Each method is one call
// of the API, typed as far as the allocator reads it; an answer the API gives as an error is a DockerError with the
// status and the daemon's own message.
import { request, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { StdStreamDemuxer, demuxAll } from "./stdstream.js";

export class DockerError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    readonly what: string,
  ) {
    super(`${what}: ${reason} (HTTP ${status})`);
  }
}

// The API version this client needs at least: volume subpaths (a mount of one directory of a volume) came in 1.45.
export const MIN_API_VERSION = "1.45";

export interface ContainerInspect {
  Id: string;
  Name: string;
  Created: string;
  State: { Status: string; Running: boolean; Pid: number; ExitCode: number; OOMKilled: boolean; StartedAt: string; FinishedAt: string; Error?: string };
  Config: { Image: string; User: string; Env: string[] | null; Labels: Record<string, string> | null; Cmd: string[] | null; WorkingDir: string };
  HostConfig: {
    NanoCpus: number;
    CpuQuota: number;
    CpuPeriod: number;
    Memory: number;
    MemorySwap: number;
    PidsLimit: number | null;
    ReadonlyRootfs: boolean;
    Privileged: boolean;
    CapAdd: string[] | null;
    CapDrop: string[] | null;
    SecurityOpt: string[] | null;
    NetworkMode: string;
    PidMode: string;
    IpcMode: string;
    UsernsMode: string;
    Binds: string[] | null;
    Devices: unknown[] | null;
    Tmpfs: Record<string, string> | null;
    PortBindings: Record<string, unknown> | null;
    Dns: string[] | null;
    Init: boolean | null;
  };
  Mounts: { Type: string; Name?: string; Source: string; Destination: string; RW: boolean; Driver?: string }[];
  NetworkSettings: { Networks: Record<string, { IPAddress: string; NetworkID: string }> | null; Ports: Record<string, unknown> | null };
}

export interface VolumeInspect {
  Name: string;
  Driver: string;
  Mountpoint: string;
  Labels: Record<string, string> | null;
  Options: Record<string, string> | null;
  UsageData?: { Size: number; RefCount: number } | null;
}

export interface NetworkInspect {
  Id: string;
  Name: string;
  Internal: boolean;
  Labels: Record<string, string> | null;
  // Keyed by container id.
  Containers: Record<string, { Name: string; IPv4Address: string }> | null;
  IPAM: { Config: { Subnet?: string; Gateway?: string }[] | null };
}

export interface ExecRun {
  stdin: Buffer | null;
  // The allocator stops waiting after this (the program itself is held to its own limit inside the container).
  timeoutMs: number;
  onStdout(chunk: Buffer): void;
  onStderr(chunk: Buffer): void;
}

const compareVersions = (a: string, b: string): number => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

const message = (body: Buffer): string => {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as { message?: unknown };
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // not JSON
  }
  return body.toString("utf8").trim().slice(0, 500) || "no message";
};

export class DockerEngine {
  private prefix: string | null = null;

  constructor(
    readonly socketPath: string,
    private readonly requestTimeoutMs = 120_000,
  ) {}

  private send(method: string, path: string, body?: unknown, timeoutMs = this.requestTimeoutMs): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
      const req = request(
        { socketPath: this.socketPath, method, path, headers: { Host: "docker", ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`the container runtime did not answer ${method} ${path} within ${timeoutMs} ms`)));
      req.on("error", reject);
      req.end(payload ?? undefined);
    });
  }

  // The API's path prefix for this daemon (its own version, refused below the minimum).
  private async api(path: string): Promise<string> {
    if (this.prefix === null) {
      const v = await this.send("GET", "/version");
      if (v.status !== 200) throw new DockerError(v.status, message(v.body), "version");
      const version = (JSON.parse(v.body.toString("utf8")) as { ApiVersion?: string }).ApiVersion ?? "0";
      if (compareVersions(version, MIN_API_VERSION) < 0) throw new DockerError(0, `the container runtime speaks API ${version}; the allocator needs ${MIN_API_VERSION} or later (volume subpaths)`, "version");
      this.prefix = `/v${version}`;
    }
    return `${this.prefix}${path}`;
  }

  private async call(method: string, path: string, what: string, ok: readonly number[], body?: unknown, timeoutMs?: number): Promise<{ status: number; body: Buffer }> {
    const r = await this.send(method, await this.api(path), body, timeoutMs);
    if (!ok.includes(r.status)) throw new DockerError(r.status, message(r.body), what);
    return r;
  }

  private async json<T>(method: string, path: string, what: string, ok: readonly number[] = [200], body?: unknown, timeoutMs?: number): Promise<T> {
    const r = await this.call(method, path, what, ok, body, timeoutMs);
    return (r.body.length === 0 ? null : JSON.parse(r.body.toString("utf8"))) as T;
  }

  // ---- the daemon --------------------------------------------------------------------------------------------------

  async ping(): Promise<boolean> {
    try {
      return (await this.send("GET", "/_ping", undefined, 5_000)).status === 200;
    } catch {
      return false;
    }
  }

  version(): Promise<{ Version: string; ApiVersion: string; Os: string; Arch: string; KernelVersion: string }> {
    return this.json("GET", "/version", "version");
  }

  info(): Promise<{ NCPU: number; MemTotal: number; CgroupVersion?: string; CgroupDriver?: string; Driver: string; DockerRootDir: string; SecurityOptions?: string[]; Name: string }> {
    return this.json("GET", "/info", "info");
  }

  // ---- images ------------------------------------------------------------------------------------------------------

  async imageInspect(ref: string): Promise<{ Id: string; RepoDigests: string[] | null; Config: { User: string } } | null> {
    const r = await this.send("GET", await this.api(`/images/${encodeURIComponent(ref)}/json`));
    if (r.status === 404) return null;
    if (r.status !== 200) throw new DockerError(r.status, message(r.body), `image ${ref}`);
    return JSON.parse(r.body.toString("utf8")) as { Id: string; RepoDigests: string[] | null; Config: { User: string } };
  }

  // ---- containers --------------------------------------------------------------------------------------------------

  // The container's id; `null` when one of that name already exists (409): the caller inspects it.
  async containerCreate(name: string, body: unknown): Promise<{ id: string; warnings: string[] } | null> {
    const r = await this.send("POST", await this.api(`/containers/create?name=${encodeURIComponent(name)}`), body);
    if (r.status === 409) return null;
    if (r.status !== 201) throw new DockerError(r.status, message(r.body), `create container ${name}`);
    const parsed = JSON.parse(r.body.toString("utf8")) as { Id: string; Warnings: string[] | null };
    return { id: parsed.Id, warnings: parsed.Warnings ?? [] };
  }

  async containerStart(id: string): Promise<void> {
    await this.call("POST", `/containers/${encodeURIComponent(id)}/start`, `start container ${id}`, [204, 304]);
  }

  // SIGTERM (the image's stop signal), then SIGKILL after `seconds`.
  async containerStop(id: string, seconds: number): Promise<"stopped" | "not_running" | "not_found"> {
    const r = await this.send("POST", await this.api(`/containers/${encodeURIComponent(id)}/stop?t=${Math.max(0, Math.round(seconds))}`), undefined, (seconds + 30) * 1000);
    if (r.status === 204) return "stopped";
    if (r.status === 304) return "not_running";
    if (r.status === 404) return "not_found";
    throw new DockerError(r.status, message(r.body), `stop container ${id}`);
  }

  async containerRemove(id: string, force: boolean): Promise<"removed" | "not_found"> {
    const r = await this.send("DELETE", await this.api(`/containers/${encodeURIComponent(id)}?force=${force ? 1 : 0}&v=0`));
    if (r.status === 204) return "removed";
    if (r.status === 404) return "not_found";
    throw new DockerError(r.status, message(r.body), `remove container ${id}`);
  }

  async containerInspect(id: string): Promise<ContainerInspect | null> {
    const r = await this.send("GET", await this.api(`/containers/${encodeURIComponent(id)}/json`));
    if (r.status === 404) return null;
    if (r.status !== 200) throw new DockerError(r.status, message(r.body), `inspect container ${id}`);
    return JSON.parse(r.body.toString("utf8")) as ContainerInspect;
  }

  containerList(labels: Record<string, string | null>): Promise<{ Id: string; Names: string[]; Labels: Record<string, string>; State: string }[]> {
    const filters = { label: Object.entries(labels).map(([k, v]) => (v === null ? k : `${k}=${v}`)) };
    return this.json("GET", `/containers/json?all=1&filters=${encodeURIComponent(JSON.stringify(filters))}`, "list containers");
  }

  async containerWait(id: string, timeoutMs: number): Promise<number | null> {
    try {
      const r = await this.json<{ StatusCode: number }>("POST", `/containers/${encodeURIComponent(id)}/wait?condition=not-running`, `wait for container ${id}`, [200], undefined, timeoutMs);
      return r.StatusCode;
    } catch (err) {
      if (err instanceof Error && /did not answer/.test(err.message)) return null;
      throw err;
    }
  }

  async containerLogs(id: string, tail = 400): Promise<{ stdout: Buffer; stderr: Buffer }> {
    const r = await this.call("GET", `/containers/${encodeURIComponent(id)}/logs?stdout=1&stderr=1&tail=${tail}`, `logs of container ${id}`, [200]);
    return demuxAll(r.body);
  }

  async containerStats(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.send("GET", await this.api(`/containers/${encodeURIComponent(id)}/stats?stream=0&one-shot=1`), undefined, 30_000);
    if (r.status === 404) return null;
    if (r.status !== 200) throw new DockerError(r.status, message(r.body), `stats of container ${id}`);
    return JSON.parse(r.body.toString("utf8")) as Record<string, unknown>;
  }

  // ---- exec ----------------------------------------------------------------------------------------------------------

  async execCreate(id: string, config: { Cmd: string[]; Env?: string[]; User?: string; WorkingDir?: string; AttachStdin: boolean }): Promise<string> {
    const r = await this.json<{ Id: string }>("POST", `/containers/${encodeURIComponent(id)}/exec`, `exec in container ${id}`, [201], { ...config, AttachStdout: true, AttachStderr: true, Tty: false, Privileged: false });
    return r.Id;
  }

  async execInspect(execId: string): Promise<{ ExitCode: number | null; Running: boolean; Pid: number }> {
    return this.json("GET", `/exec/${encodeURIComponent(execId)}/json`, `inspect exec ${execId}`);
  }

  // Starts an exec on a hijacked connection: what it prints is handed over as it comes, `stdin` is written and then the
  // connection's writing half closed (the program's end of input). Resolves when the program's output ends -- or when
  // the allocator stops waiting (`timedOut`).
  async execStart(execId: string, run: ExecRun): Promise<{ timedOut: boolean; truncatedStream: boolean }> {
    const path = await this.api(`/exec/${encodeURIComponent(execId)}/start`);
    return new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify({ Detach: false, Tty: false }), "utf8");
      const req = request({ socketPath: this.socketPath, method: "POST", path, headers: { Host: "docker", "Content-Type": "application/json", "Content-Length": payload.length, Connection: "Upgrade", Upgrade: "tcp" } });
      const demux = new StdStreamDemuxer((s, b) => (s === "stdout" ? run.onStdout(b) : run.onStderr(b)));
      let stream: Socket | IncomingMessage | null = null;
      let settled = false;
      const done = (timedOut: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut, truncatedStream: demux.leftover > 0 });
      };
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
      const timer = setTimeout(() => {
        stream?.destroy();
        req.destroy();
        done(true);
      }, run.timeoutMs);
      const follow = (s: Socket | IncomingMessage, head?: Buffer) => {
        stream = s;
        if (head && head.length > 0) demux.push(head);
        s.on("data", (c: Buffer) => demux.push(c));
        s.on("end", () => done(false));
        s.on("close", () => done(false));
        s.on("error", () => done(false));
      };
      req.on("upgrade", (_res, socket: Socket, head: Buffer) => {
        follow(socket, head);
        if (run.stdin !== null) socket.end(run.stdin);
      });
      req.on("response", (res: IncomingMessage) => {
        if (res.statusCode === 200) {
          follow(res);
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => fail(new DockerError(res.statusCode ?? 0, message(Buffer.concat(chunks)), `start exec ${execId}`)));
      });
      req.on("error", fail);
      req.end(payload);
    });
  }

  // ---- volumes -----------------------------------------------------------------------------------------------------

  async volumeCreate(body: { Name: string; Driver?: string; DriverOpts?: Record<string, string>; Labels?: Record<string, string> }): Promise<VolumeInspect> {
    return this.json("POST", "/volumes/create", `create volume ${body.Name}`, [201], { Driver: "local", ...body });
  }

  async volumeInspect(name: string): Promise<VolumeInspect | null> {
    const r = await this.send("GET", await this.api(`/volumes/${encodeURIComponent(name)}`));
    if (r.status === 404) return null;
    if (r.status !== 200) throw new DockerError(r.status, message(r.body), `inspect volume ${name}`);
    return JSON.parse(r.body.toString("utf8")) as VolumeInspect;
  }

  async volumeRemove(name: string): Promise<"removed" | "not_found" | "in_use"> {
    const r = await this.send("DELETE", await this.api(`/volumes/${encodeURIComponent(name)}?force=0`));
    if (r.status === 204) return "removed";
    if (r.status === 404) return "not_found";
    if (r.status === 409) return "in_use";
    throw new DockerError(r.status, message(r.body), `remove volume ${name}`);
  }

  // ---- networks ----------------------------------------------------------------------------------------------------

  async networkInspect(name: string): Promise<NetworkInspect | null> {
    const r = await this.send("GET", await this.api(`/networks/${encodeURIComponent(name)}`));
    if (r.status === 404) return null;
    if (r.status !== 200) throw new DockerError(r.status, message(r.body), `inspect network ${name}`);
    return JSON.parse(r.body.toString("utf8")) as NetworkInspect;
  }

  // The network's id; `null` when one of that name already exists (409).
  async networkCreate(body: { Name: string; Internal: boolean; Labels?: Record<string, string>; IPAM?: { Config: { Subnet: string }[] } }): Promise<string | null> {
    const r = await this.send("POST", await this.api("/networks/create"), { Driver: "bridge", CheckDuplicate: true, ...body });
    if (r.status === 409) return null;
    if (r.status !== 201) throw new DockerError(r.status, message(r.body), `create network ${body.Name}`);
    return (JSON.parse(r.body.toString("utf8")) as { Id: string }).Id;
  }

  async networkList(labels: Record<string, string>): Promise<{ Id: string; Name: string; Internal: boolean; Labels: Record<string, string> | null; IPAM: { Config: { Subnet?: string }[] | null } }[]> {
    const filters = { label: Object.entries(labels).map(([k, v]) => `${k}=${v}`) };
    return this.json("GET", `/networks?filters=${encodeURIComponent(JSON.stringify(filters))}`, "list networks");
  }

  // Connected (or already so): "connected" | "already".
  async networkConnect(network: string, container: string, aliases: string[]): Promise<"connected" | "already"> {
    const r = await this.send("POST", await this.api(`/networks/${encodeURIComponent(network)}/connect`), { Container: container, EndpointConfig: { Aliases: aliases } });
    if (r.status === 200) return "connected";
    if (r.status === 403 && /already exists|already attached/i.test(message(r.body))) return "already";
    throw new DockerError(r.status, message(r.body), `connect ${container} to ${network}`);
  }

  async networkDisconnect(network: string, container: string): Promise<void> {
    const r = await this.send("POST", await this.api(`/networks/${encodeURIComponent(network)}/disconnect`), { Container: container, Force: true });
    if (r.status !== 200 && r.status !== 404 && !(r.status === 403 && /not connected/i.test(message(r.body)))) throw new DockerError(r.status, message(r.body), `disconnect ${container} from ${network}`);
  }

  async networkRemove(name: string): Promise<"removed" | "not_found"> {
    const r = await this.call("DELETE", `/networks/${encodeURIComponent(name)}`, `remove network ${name}`, [204, 404]);
    return r.status === 204 ? "removed" : "not_found";
  }
}
