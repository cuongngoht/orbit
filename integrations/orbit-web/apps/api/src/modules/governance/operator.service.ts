// OPERATORS: the people who administer governance, each verified by Orbit Web itself. Never derived from the Claude
// sign-in (that is the instance's account: whoever reaches Orbit Web works as it), never from the access token (that
// opens the workspace), and never from anything a request says about itself.
//
//   bootstrap   the first owner, with the one-time code from Orbit Web's own log (bootstrap-code.ts), once
//   sign-in     username and password (scrypt), a few failures lock the name for a while; a session is a random token
//               in an HttpOnly, SameSite=Strict cookie, kept here as its SHA-256, ending after a while idle and after
//               a fixed time in any case, and at once when it is revoked or its operator is suspended
//   roles       read from the store on every request; an operator never changes their own, and the organization always
//               keeps one active owner
//
// Every change is an audit record written in the same transaction as the change.
import { HttpStatus, Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import {
  can,
  permissionsOf,
  type OperatorRole,
} from "@orbit-web/governance-core";
import {
  checkBootstrap,
  checkChangePassword,
  checkCreateOperator,
  checkLogin,
  checkRoleChange,
  type GovernanceState,
  type OperatorSessionView,
  type OperatorView,
} from "@orbit-web/contracts";
import { randomBytes, randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { OperatorStore, sha256, type OperatorRecord } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import { BootstrapCode } from "./bootstrap-code.js";
import { hashPassword, verifyDecoy, verifyPassword } from "./passwords.js";
import type { GovernanceContext, Principal } from "./principal.js";

export const OPERATOR_COOKIE = "orbit_web_operator";

// A session ends after this long whatever happens, and after IDLE without a request.
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_MS = 60 * 1000;

// Five wrong passwords for one name within the window lock that name for LOCK_MS.
export const LOCK_AFTER = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const csrfOf = (token: string): string => sha256(`orbit-web/operator-csrf/${token}`);

export const viewOf = (o: OperatorRecord): OperatorView => ({ id: o.id, username: o.username, displayName: o.displayName, status: o.status, roles: o.roles, createdAt: o.createdAt });

export interface OpenedSession {
  token: string;
  state: GovernanceState;
}

@Injectable()
export class OperatorService implements OnApplicationBootstrap {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(OperatorStore) private readonly operators: OperatorStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BootstrapCode) private readonly code: BootstrapCode,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    if (this.operators.organization() === null) this.code.issue();
  }

  initialized(): boolean {
    return this.operators.organization() !== null;
  }

  state(principal: Principal): GovernanceState {
    const org = this.operators.organization();
    return {
      initialized: org !== null,
      organization: org === null ? null : { id: org.id, name: org.name },
      bootstrapOpen: org === null && this.code.isOpen(),
      session: principal.kind === "operator" ? this.sessionView(principal) : null,
      deployment: this.config.governance.deployment,
    };
  }

  // The operator a session cookie names, as of now -- or null: unknown, revoked, expired, idle too long, or its
  // operator suspended.
  sessionPrincipal(token: string): Principal | null {
    const session = this.operators.sessionByToken(sha256(token));
    if (session === null || session.revokedAt !== null) return null;
    const now = Date.now();
    if (Date.parse(session.expiresAt) <= now || now - Date.parse(session.lastSeenAt) > SESSION_IDLE_MS) return null;
    const operator = this.operators.byId(session.operatorId);
    if (operator === null || operator.status !== "active") return null;
    if (now - Date.parse(session.lastSeenAt) > TOUCH_MS) this.operators.touchSession(session.id, new Date(now).toISOString());
    return { kind: "operator", operatorId: operator.id, username: operator.username, sessionId: session.id, roles: operator.roles, permissions: permissionsOf(operator.roles), csrfToken: csrfOf(token), expiresAt: session.expiresAt };
  }

  private sessionView(p: Extract<Principal, { kind: "operator" }>): OperatorSessionView | null {
    const operator = this.operators.byId(p.operatorId);
    return operator === null ? null : { operator: viewOf(operator), permissions: p.permissions, csrfToken: p.csrfToken, expiresAt: p.expiresAt };
  }

  // ---- the first owner -------------------------------------------------------------------------------------------------

  async bootstrap(ctx: GovernanceContext, body: unknown): Promise<OpenedSession> {
    const req = accepted(checkBootstrap(body));
    if (this.initialized()) {
      this.audit.record(ctx, { type: "operator.bootstrap.refused", outcome: "refused", data: { cause: "already_initialized" } });
      throw conflict("already_initialized", "Governance already has an owner: sign in as an operator.");
    }
    const taken = this.code.take(req.code);
    if (taken !== "accepted") {
      this.audit.record(ctx, { type: "operator.bootstrap.refused", outcome: "refused", data: { cause: taken === "closed" ? "no_open_code" : "wrong_code" } });
      if (taken === "closed") throw conflict("bootstrap_closed", "No first-owner code is open: restart Orbit Web to get a new one in its log, or use the installation's terminal (README).");
      throw new ApiError(HttpStatus.FORBIDDEN, "bootstrap_code_invalid", "That is not the code in Orbit Web's log.");
    }
    const passwordHash = await hashPassword(req.password);
    const at = new Date().toISOString();
    const operatorId = `op-${randomUUID()}`;
    return this.database.transaction(() => {
      if (this.initialized()) throw conflict("already_initialized", "Governance already has an owner: sign in as an operator.");
      this.operators.createOrganization({ id: `org-${randomBytes(6).toString("hex")}`, name: req.organizationName, createdAt: at });
      this.operators.create({ id: operatorId, username: req.username, displayName: req.displayName, passwordHash, status: "active", createdAt: at, createdBy: "bootstrap", passwordChangedAt: at });
      this.operators.grant(operatorId, "organization_owner", "bootstrap", at);
      const operator = this.operators.byId(operatorId) as OperatorRecord;
      const as = { ...ctx, principal: this.principalOf(operator, "", "") };
      this.audit.record(as, { type: "governance.initialized", outcome: "initialized", data: { organizationName: req.organizationName } });
      this.audit.record(as, { type: "operator.created", outcome: "created", data: { operatorId, username: req.username, roles: "organization_owner" } });
      this.audit.record(as, { type: "operator.role.granted", outcome: "granted", data: { operatorId, role: "organization_owner" } });
      const opened = this.openSession(ctx, operator);
      this.changed("operators");
      return opened;
    });
  }

  // ---- signing in and out ------------------------------------------------------------------------------------------------

  async login(ctx: GovernanceContext, body: unknown): Promise<OpenedSession> {
    const req = accepted(checkLogin(body));
    const lockedUntil = this.lockedUntil(req.username);
    if (lockedUntil !== null) {
      this.audit.record(ctx, { type: "operator.sign_in.failed", outcome: "refused", data: { username: req.username, cause: "locked" } });
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, "sign_in_locked", `Too many failed sign-ins for this name: try again after ${lockedUntil}.`);
    }
    const found = this.operators.byUsername(req.username);
    const ok = found === null ? await verifyDecoy(req.password) : await verifyPassword(req.password, found.passwordHash);
    const operator = this.operators.byUsername(req.username);
    if (!ok || operator === null || operator.passwordHash !== found?.passwordHash) {
      this.database.transaction(() => {
        this.recordFailure(req.username);
        this.audit.record(ctx, { type: "operator.sign_in.failed", outcome: "refused", data: { username: req.username, cause: "wrong_credentials" } });
      });
      throw new ApiError(HttpStatus.UNAUTHORIZED, "invalid_credentials", "That username and password are not an Orbit operator's.");
    }
    if (operator.status !== "active") {
      this.audit.record(ctx, { type: "operator.sign_in.failed", outcome: "refused", data: { username: req.username, cause: "suspended" } });
      throw new ApiError(HttpStatus.FORBIDDEN, "operator_suspended", "This operator is suspended.");
    }
    return this.database.transaction(() => {
      this.operators.clearFailures(req.username);
      return this.openSession(ctx, operator);
    });
  }

  logout(ctx: GovernanceContext): void {
    const p = ctx.principal;
    if (p.kind !== "operator") return;
    this.database.transaction(() => {
      this.operators.revokeSession(p.sessionId, new Date().toISOString(), "signed_out");
      this.audit.record(ctx, { type: "operator.signed_out", outcome: "signed_out", data: { sessionId: p.sessionId } });
    });
  }

  async changePassword(ctx: GovernanceContext, body: unknown): Promise<void> {
    const req = accepted(checkChangePassword(body));
    const p = this.operatorOf(ctx);
    const operator = this.operators.byId(p.operatorId);
    if (operator === null || !(await verifyPassword(req.currentPassword, operator.passwordHash))) {
      this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { permission: "operator.password", route: "POST /api/operator/password", cause: "wrong_password" } });
      throw new ApiError(HttpStatus.FORBIDDEN, "invalid_credentials", "The current password is not right.");
    }
    const hash = await hashPassword(req.newPassword);
    this.database.transaction(() => {
      const at = new Date().toISOString();
      this.operators.setPassword(operator.id, hash, at);
      const ended = this.operators.revokeSessions(operator.id, at, "password_changed", p.sessionId);
      this.audit.record(ctx, { type: "operator.password.changed", outcome: "changed", data: { operatorId: operator.id } });
      if (ended > 0) this.audit.record(ctx, { type: "operator.session.revoked", outcome: "revoked", data: { operatorId: operator.id, sessions: ended } });
    });
  }

  // ---- the operators an owner manages ------------------------------------------------------------------------------------

  list(): OperatorView[] {
    return this.operators.list().map(viewOf);
  }

  async create(ctx: GovernanceContext, body: unknown): Promise<OperatorView> {
    const req = accepted(checkCreateOperator(body));
    const p = this.operatorOf(ctx);
    if (req.roles.length > 0 && !can(p.roles, "roles.manage")) throw new ApiError(HttpStatus.FORBIDDEN, "permission_required", "Giving an operator a role needs the permission to manage roles.");
    if (this.operators.byUsername(req.username) !== null) throw conflict("username_taken", `An operator named ${req.username} already exists.`);
    const hash = await hashPassword(req.password);
    return this.database.transaction(() => {
      if (this.operators.byUsername(req.username) !== null) throw conflict("username_taken", `An operator named ${req.username} already exists.`);
      const at = new Date().toISOString();
      const id = `op-${randomUUID()}`;
      this.operators.create({ id, username: req.username, displayName: req.displayName, passwordHash: hash, status: "active", createdAt: at, createdBy: p.operatorId, passwordChangedAt: at });
      this.audit.record(ctx, { type: "operator.created", outcome: "created", data: { operatorId: id, username: req.username, roles: req.roles.join(",") } });
      for (const role of req.roles) this.grantRole(ctx, id, role, at);
      this.changed("operators");
      return viewOf(this.operators.byId(id) as OperatorRecord);
    });
  }

  suspend(ctx: GovernanceContext, id: string): OperatorView {
    const p = this.operatorOf(ctx);
    const target = this.existing(id);
    if (target.id === p.operatorId) throw conflict("self", "An operator never suspends themselves.");
    if (target.status === "suspended") return viewOf(target);
    this.keepOneOwner(target, "suspended");
    return this.database.transaction(() => {
      const at = new Date().toISOString();
      this.operators.setStatus(id, "suspended");
      const ended = this.operators.revokeSessions(id, at, "suspended");
      this.audit.record(ctx, { type: "operator.suspended", outcome: "suspended", data: { operatorId: id } });
      if (ended > 0) this.audit.record(ctx, { type: "operator.session.revoked", outcome: "revoked", data: { operatorId: id, sessions: ended } });
      this.changed("operators");
      return viewOf(this.existing(id));
    });
  }

  reinstate(ctx: GovernanceContext, id: string): OperatorView {
    const target = this.existing(id);
    if (target.status === "active") return viewOf(target);
    return this.database.transaction(() => {
      this.operators.setStatus(id, "active");
      this.audit.record(ctx, { type: "operator.reinstated", outcome: "reinstated", data: { operatorId: id } });
      this.changed("operators");
      return viewOf(this.existing(id));
    });
  }

  changeRoles(ctx: GovernanceContext, id: string, body: unknown): OperatorView {
    const req = accepted(checkRoleChange(body));
    const p = this.operatorOf(ctx);
    const target = this.existing(id);
    if (target.id === p.operatorId) throw conflict("self_role_change", "An operator never changes their own roles: another owner does.");
    if (req.revoke.includes("organization_owner") && target.roles.includes("organization_owner")) this.keepOneOwner(target, "stripped of the owner role");
    return this.database.transaction(() => {
      const at = new Date().toISOString();
      for (const role of req.grant) this.grantRole(ctx, id, role, at);
      for (const role of req.revoke) if (this.operators.revoke(id, role)) this.audit.record(ctx, { type: "operator.role.revoked", outcome: "revoked", data: { operatorId: id, role } });
      this.changed("operators");
      return viewOf(this.existing(id));
    });
  }

  revokeSessions(ctx: GovernanceContext, id: string): { sessions: number } {
    this.existing(id);
    return this.database.transaction(() => {
      const sessions = this.operators.revokeSessions(id, new Date().toISOString(), "revoked");
      this.audit.record(ctx, { type: "operator.session.revoked", outcome: "revoked", data: { operatorId: id, sessions } });
      return { sessions };
    });
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private openSession(ctx: GovernanceContext, operator: OperatorRecord): OpenedSession {
    const token = randomBytes(32).toString("base64url");
    const id = `ops-${randomUUID()}`;
    const now = Date.now();
    this.operators.createSession({ id, tokenHash: sha256(token), operatorId: operator.id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + SESSION_LIFETIME_MS).toISOString() });
    const principal = this.principalOf(operator, id, token, new Date(now + SESSION_LIFETIME_MS).toISOString());
    this.audit.record({ ...ctx, principal }, { type: "operator.signed_in", outcome: "signed_in", data: { sessionId: id } });
    return { token, state: this.state(principal) };
  }

  private principalOf(operator: OperatorRecord, sessionId: string, token: string, expiresAt = ""): Extract<Principal, { kind: "operator" }> {
    return { kind: "operator", operatorId: operator.id, username: operator.username, sessionId, roles: operator.roles, permissions: permissionsOf(operator.roles), csrfToken: token === "" ? "" : csrfOf(token), expiresAt };
  }

  private grantRole(ctx: GovernanceContext, operatorId: string, role: OperatorRole, at: string): void {
    const p = this.operatorOf(ctx);
    if (this.operators.grant(operatorId, role, p.operatorId, at)) this.audit.record(ctx, { type: "operator.role.granted", outcome: "granted", data: { operatorId, role } });
  }

  private operatorOf(ctx: GovernanceContext): Extract<Principal, { kind: "operator" }> {
    if (ctx.principal.kind !== "operator") throw new ApiError(HttpStatus.UNAUTHORIZED, "operator_required", "Sign in as an Orbit operator first.");
    return ctx.principal;
  }

  private existing(id: string): OperatorRecord {
    const o = this.operators.byId(id);
    if (o === null) throw notFound("The operator");
    return o;
  }

  // The organization always keeps one active owner who can sign in.
  private keepOneOwner(target: OperatorRecord, what: string): void {
    const owners = this.operators.activeOwners();
    if (owners.includes(target.id) && owners.length === 1) throw conflict("last_owner", `${target.username} is the organization's only active owner and cannot be ${what}: make another owner first.`);
  }

  private lockedUntil(username: string): string | null {
    const f = this.operators.failures(username);
    return f?.lockedUntil !== null && f?.lockedUntil !== undefined && Date.parse(f.lockedUntil) > Date.now() ? f.lockedUntil : null;
  }

  private recordFailure(username: string): void {
    const now = Date.now();
    const old = this.operators.failures(username);
    const fresh = old === null || now - Date.parse(old.firstAt) > FAILURE_WINDOW_MS || (old.lockedUntil !== null && Date.parse(old.lockedUntil) <= now);
    const failures = fresh ? 1 : (old as { failures: number }).failures + 1;
    const firstAt = fresh ? new Date(now).toISOString() : (old as { firstAt: string }).firstAt;
    this.operators.setFailures(username, { failures, firstAt, lockedUntil: failures >= LOCK_AFTER ? new Date(now + LOCK_MS).toISOString() : null });
  }

  private changed(area: "operators"): void {
    this.database.afterCommit(() => this.bus.publishApp("governance.changed", { area, id: null }));
  }
}
