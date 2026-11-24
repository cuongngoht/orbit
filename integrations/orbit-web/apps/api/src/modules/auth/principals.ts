// Who a request is from, worked out once per request from what Orbit Web itself issued: a run's token (RUN_TOKEN_HEADER,
// minted for one run), a browser's session (its cookie), or neither. And where it came from: in the governed deployment,
// the agent container's network is a fact of the socket, which the agent cannot choose -- unlike a Host header or
// anything else a request says.
//
// A run's token never falls through to a cookie, and nothing from the agent's network is a person's, whatever cookie it
// carries: an agent never becomes an owner.
import { Inject, Injectable } from "@nestjs/common";
import { RUN_TOKEN_HEADER } from "@orbit-web/contracts";
import type { Request } from "express";
import { BlockList, isIPv4 } from "node:net";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { RunBindingStore, sha256, type RunBinding } from "../../infra/governance/stores.js";
import { cookieValue } from "../../infra/security/guards.js";
import { currentCorrelation } from "../../common/request-scope.js";
import { AccountsService } from "./accounts.service.js";
import { contextOf, type GovernanceContext, type Principal } from "./principal.js";

// The browser session's cookie.
export const SESSION_COOKIE = "orbit_web_session";

export interface Resolution {
  principal: Principal;
  // A run token was presented and is not a live run's (or is a research run's, which opens the egress proxy alone).
  invalidRunToken: boolean;
  // The session token this request carried, when it named a live session (its owner is `principal`).
  sessionToken: string | null;
}

const unmapped = (address: string): string => (address.startsWith("::ffff:") ? address.slice(7) : address);

// The networks given as CIDR (`a.b.c.d/n`), as one list a socket's address is checked against.
export function networkList(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const [net, prefix] = cidr.split("/") as [string, string];
    list.addSubnet(net, Number(prefix), "ipv4");
  }
  return list;
}

export const fromNetwork = (list: BlockList, address: string | undefined): boolean => {
  const a = unmapped(address ?? "");
  return isIPv4(a) && list.check(a, "ipv4");
};

@Injectable()
export class PrincipalResolver {
  private readonly cache = new WeakMap<Request, Promise<Resolution>>();
  private readonly settled = new WeakMap<Request, Resolution>();
  private readonly agentNetworks: BlockList;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(RunBindingStore) private readonly runs: RunBindingStore,
  ) {
    this.agentNetworks = networkList(config.governance.agentNetworks);
  }

  fromAgentNetwork(req: Request): boolean {
    return this.config.governance.deployment === "governed" && fromNetwork(this.agentNetworks, req.socket.remoteAddress);
  }

  resolve(req: Request): Promise<Resolution> {
    const cached = this.cache.get(req);
    if (cached !== undefined) return cached;
    const resolution = this.compute(req).then((r) => (this.settled.set(req, r), r));
    this.cache.set(req, resolution);
    return resolution;
  }

  // The principal the gate established for this request (it resolved it before any route ran).
  of(req: Request): Principal {
    return this.settled.get(req)?.principal ?? { kind: "anonymous", agentNetwork: this.fromAgentNetwork(req) };
  }

  context(req: Request): GovernanceContext {
    return contextOf(this.of(req), currentCorrelation());
  }

  // A live run's binding for a token: not ended, not past its time.
  async binding(token: string): Promise<RunBinding | null> {
    const b = await this.runs.byToken(sha256(token));
    return b !== null && b.endedAt === null && Date.parse(b.expiresAt) > Date.now() ? b : null;
  }

  private async compute(req: Request): Promise<Resolution> {
    const agentNetwork = this.fromAgentNetwork(req);
    const anonymous: Principal = { kind: "anonymous", agentNetwork };
    const runToken = req.headers[RUN_TOKEN_HEADER];
    if (typeof runToken === "string" && runToken.length > 0) {
      const binding = await this.binding(runToken);
      // A research run's token, and an employee's answer in CEO Chat (no tool), open the egress proxy alone: never the
      // agent gateway, the tool endpoint or anything else.
      if (binding === null || binding.kind === "research" || binding.kind === "executive") return { principal: anonymous, invalidRunToken: true, sessionToken: null };
      return { principal: { kind: "agent", binding }, invalidRunToken: false, sessionToken: null };
    }
    const token = agentNetwork ? null : cookieValue(req.headers.cookie, SESSION_COOKIE);
    if (token === null || token.length === 0) return { principal: anonymous, invalidRunToken: false, sessionToken: null };
    const resolved = await this.accounts.resolve(token);
    if (resolved === null) return { principal: anonymous, invalidRunToken: false, sessionToken: null };
    return { principal: resolved.owner, invalidRunToken: false, sessionToken: token };
  }
}
