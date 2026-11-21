// WHETHER THE AGENT RUNS APART FROM THE CONTROL PLANE, said as what was checked -- never assumed.
//
//   single    Claude Code runs in this container, as this container's user: it can read and change every file here,
//             and reach what this container reaches. Governance holds at the API (no browser session, no run token of
//             another run, no switch is the agent's), not at the files. NOT PROVEN -- and an account id on every record
//             is not isolation either: every account's runs share this container. A run is refused here when its
//             account's policy requires isolation.
//   governed  the agent runs in a container of its own through a runner; before a run that requires it, the control plane checks
//             it: canaries it wrote where only it can see them must be absent in the agent's container, a canary in the
//             agent's own room must be there, and a direct connection out must fail. ATTESTED only when all of that held
//             just now. What the runner answers is the agent container's word: the check proves the deployment is not
//             mis-wired, not that a compromised runner tells the truth.
import { Inject, Injectable } from "@nestjs/common";
import type { IsolationCheck, IsolationStatus } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { IsolationStore } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import { systemContext } from "../auth/principal.js";

export const SINGLE_DETAIL =
  "Claude Code runs in this container as this container's user: it could read and change Orbit Web's files, and every account's runs share it. Governance holds at the API here -- the agent has no browser session, no switch and no gateway beyond its own run -- not at the files. Where isolation is required, run Orbit Web as the governed deployment (docker/compose.governed.yaml).";

// An attestation older than this is not taken for a run: a run asks again.
export const ATTESTATION_TTL_MS = 5 * 60 * 1000;

export interface Attestor {
  attest(): Promise<{ checks: IsolationCheck[] }>;
}

@Injectable()
export class IsolationService {
  private attestor: Attestor | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(IsolationStore) private readonly store: IsolationStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // The runner side registers itself in the governed deployment (modules/isolation).
  setAttestor(attestor: Attestor): void {
    this.attestor = attestor;
  }

  async status(): Promise<IsolationStatus> {
    if (this.config.governance.deployment === "single") return { deployment: "single", state: "not_proven", checkedAt: null, checks: [], detail: SINGLE_DETAIL };
    const latest = await this.store.latest();
    if (latest === null) return { deployment: "governed", state: "not_proven", checkedAt: null, checks: [], detail: "The agent's container has not been checked yet: it is checked before every run that requires it." };
    return { deployment: "governed", state: latest.state, checkedAt: latest.checkedAt, checks: latest.checks, detail: latest.detail };
  }

  // Checks the agent's container now (governed); a single deployment is never attested.
  async attest(): Promise<IsolationStatus> {
    if (this.config.governance.deployment === "single" || this.attestor === null) return this.status();
    let checks: IsolationCheck[];
    try {
      checks = (await this.attestor.attest()).checks;
    } catch (err) {
      checks = [{ name: "runner", ok: false, detail: `the agent's runner did not answer: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}` }];
    }
    const ok = checks.length > 0 && checks.every((c) => c.ok);
    const record = { checkedAt: new Date().toISOString(), state: ok ? ("attested" as const) : ("failed" as const), checks, detail: ok ? "The agent's container was checked just now: none of the control plane's rooms is in it, its own room is, and it has no way out but the proxy." : `The agent's container failed ${checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}.` };
    await this.store.insert(record);
    // What was checked is evidence too (the deployment's: the run that follows names this state).
    await this.audit.record(systemContext("isolation"), { type: ok ? "isolation.attested" : "isolation.failed", outcome: record.state, data: ok ? { runner: this.config.governance.runner?.host ?? "runner", checks: checks.map((c) => c.name).join(",") } : { cause: record.detail } });
    return { deployment: "governed", ...record };
  }

  // A fresh attestation, or a new check.
  async fresh(): Promise<IsolationStatus> {
    const s = await this.status();
    if (s.state === "attested" && s.checkedAt !== null && Date.now() - Date.parse(s.checkedAt) < ATTESTATION_TTL_MS) return s;
    return this.attest();
  }
}
