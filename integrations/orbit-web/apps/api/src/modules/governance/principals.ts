// Who a request is from, worked out once per request from what Orbit Web itself issued: a run's token (the
// RUN_TOKEN_HEADER, minted for one governed run), an operator's session (its cookie), or neither. And where it came
// from: in the governed deployment, the agent container's network is a fact of the socket, which the agent cannot
// choose -- unlike a Host header or anything else in the request.
import { Inject, Injectable } from "@nestjs/common";
import { RUN_TOKEN_HEADER } from "@orbit-web/contracts";
import type { Request } from "express";
import { BlockList, isIPv4 } from "node:net";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { RunBindingStore, sha256, type RunBinding } from "../../infra/governance/stores.js";
import { cookieValue } from "../../infra/security/guards.js";
import { OPERATOR_COOKIE, OperatorService } from "./operator.service.js";
import type { GovernanceContext, Principal } from "./principal.js";

export interface Resolved {
  principal: Principal;
  // A run token was presented and is not a live run's: refused wherever it is presented.
  invalidRunToken: boolean;
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
  private readonly cache = new WeakMap<Request, Resolved>();
  private readonly correlations = new WeakMap<Request, string>();
  private readonly agentNetworks: BlockList;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OperatorService) private readonly operators: OperatorService,
    @Inject(RunBindingStore) private readonly runs: RunBindingStore,
  ) {
    this.agentNetworks = networkList(config.governance.agentNetworks);
  }

  fromAgentNetwork(req: Request): boolean {
    return this.config.governance.deployment === "governed" && fromNetwork(this.agentNetworks, req.socket.remoteAddress);
  }

  resolve(req: Request): Resolved {
    const cached = this.cache.get(req);
    if (cached !== undefined) return cached;
    const resolved = this.compute(req);
    this.cache.set(req, resolved);
    return resolved;
  }

  of(req: Request): Principal {
    return this.resolve(req).principal;
  }

  context(req: Request): GovernanceContext {
    let correlationId = this.correlations.get(req);
    if (correlationId === undefined) {
      correlationId = randomUUID();
      this.correlations.set(req, correlationId);
    }
    return { correlationId, principal: this.of(req) };
  }

  // A live run's binding for a token: not ended, not past its time.
  binding(token: string): RunBinding | null {
    const b = this.runs.byToken(sha256(token));
    return b !== null && b.endedAt === null && Date.parse(b.expiresAt) > Date.now() ? b : null;
  }

  private compute(req: Request): Resolved {
    const agentNetwork = this.fromAgentNetwork(req);
    const runToken = req.headers[RUN_TOKEN_HEADER];
    if (typeof runToken === "string" && runToken.length > 0) {
      const binding = this.binding(runToken);
      return binding === null ? { principal: { kind: "anonymous", agentNetwork }, invalidRunToken: true } : { principal: { kind: "agent", binding }, invalidRunToken: false };
    }
    // Nothing from the agent's network is a person's, whatever cookie it carries.
    const cookie = agentNetwork ? null : cookieValue(req.headers.cookie, OPERATOR_COOKIE);
    const operator = cookie === null ? null : this.operators.sessionPrincipal(cookie);
    return { principal: operator ?? { kind: "anonymous", agentNetwork }, invalidRunToken: false };
  }
}
