// ORBIT'S MOBILE AUTH (Level B): long-lived refresh tokens stored in iOS Keychain + short-lived single-use exchange
// codes traded inside the embedded WKWebView for a standard HttpOnly browser session cookie.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  checkMobileExchange,
  checkMobileLogin,
  checkMobileLogout,
  checkMobileRefresh,
  MOBILE_EXCHANGE_INVALID,
  MOBILE_REFRESH_INVALID,
  type MobileTokenGrant,
} from "@orbit-web/contracts";
import { randomBytes, randomUUID } from "node:crypto";
import { accepted, ApiError } from "../../common/errors.js";
import { MobileAuthStore, sha256, UserStore, type UserRecord } from "../../infra/accounts/stores.js";
import { Db } from "../../infra/db/db.js";
import { AccountsService, accountView, userView, type Issued } from "./accounts.service.js";
import { AuthHooks } from "./auth-hooks.js";
import { IdentityService, type ClientOf } from "./identity.service.js";
import { systemContext } from "./principal.js";

export const MOBILE_REFRESH_LIFETIME_MS = 30 * 24 * 3_600_000;
export const MOBILE_EXCHANGE_TTL_MS = 30_000;

const invalidRefresh = (): ApiError => new ApiError(HttpStatus.UNAUTHORIZED, MOBILE_REFRESH_INVALID, "This mobile session is no longer valid: sign in again.");

const invalidExchange = (): ApiError => new ApiError(HttpStatus.UNAUTHORIZED, MOBILE_EXCHANGE_INVALID, "This sign-in code expired or was already used: sign in again.");

const opaqueSecret = (): string => randomBytes(32).toString("base64url");
const clipAgent = (ua: string | null): string | null => (ua === null ? null : ua.slice(0, 200));

@Injectable()
export class MobileAuthService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(IdentityService) private readonly identity: IdentityService,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(UserStore) private readonly users: UserStore,
    @Inject(MobileAuthStore) private readonly mobileAuth: MobileAuthStore,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {}

  async login(body: unknown, client: Pick<ClientOf, "address" | "userAgent">): Promise<MobileTokenGrant> {
    const req = accepted(checkMobileLogin(body));
    const { user, account } = await this.identity.verifyCredentials(req.username, req.password, client, {
      allowVerifiedEmail: true,
      route: "POST /api/auth/mobile/login",
    });
    return this.db.tx(async () => {
      const at = new Date().toISOString();
      const refreshId = randomUUID();
      const familyId = randomUUID();
      const refreshToken = opaqueSecret();
      const exchangeCode = opaqueSecret();
      const refreshExpiresAt = new Date(Date.parse(at) + MOBILE_REFRESH_LIFETIME_MS).toISOString();
      const exchangeExpiresAt = new Date(Date.parse(at) + MOBILE_EXCHANGE_TTL_MS).toISOString();
      await this.mobileAuth.insertRefreshToken({
        id: refreshId,
        familyId,
        tokenHash: sha256(refreshToken),
        accountId: user.accountId,
        userId: user.id,
        deviceId: req.deviceId,
        deviceName: req.deviceName ?? null,
        userAgent: clipAgent(client.userAgent),
        createdAt: at,
        lastUsedAt: at,
        expiresAt: refreshExpiresAt,
      });
      await this.mobileAuth.insertExchangeCode({
        id: randomUUID(),
        codeHash: sha256(exchangeCode),
        accountId: user.accountId,
        userId: user.id,
        refreshTokenId: refreshId,
        createdAt: at,
        expiresAt: exchangeExpiresAt,
      });
      await this.users.signedIn(user.id, at);
      const signedIn = (await this.users.get(user.id)) as UserRecord;
      await this.hooks.identity(systemContext("sign-in", account.id), { kind: "mobile_signed_in", deviceId: req.deviceId });
      return { refreshToken, refreshExpiresAt, exchangeCode, exchangeExpiresAt, user: userView(signedIn), account: accountView(account) };
    });
  }

  async refresh(body: unknown, client: Pick<ClientOf, "userAgent">): Promise<MobileTokenGrant> {
    const req = accepted(checkMobileRefresh(body));
    const now = new Date().toISOString();
    const existing = await this.mobileAuth.byRefreshTokenHash(sha256(req.refreshToken));
    if (existing === null) throw invalidRefresh();
    if (existing.deviceId !== req.deviceId) {
      await this.mobileAuth.revokeFamily(existing.familyId, now, "device_mismatch");
      throw invalidRefresh();
    }
    if (existing.rotatedAt !== null) {
      await this.db.tx(async () => {
        await this.mobileAuth.revokeFamily(existing.familyId, now, "refresh_token_reused");
        await this.hooks.identity(systemContext("sign-in", existing.accountId), { kind: "mobile_refresh_reused", familyId: existing.familyId });
      });
      throw invalidRefresh();
    }
    if (existing.revokedAt !== null || Date.parse(existing.expiresAt) <= Date.parse(now)) throw invalidRefresh();
    const user = await this.accounts.user(existing.userId);
    const account = await this.accounts.account(existing.accountId);
    if (user === null || account === null || user.disabledAt !== null || account.status !== "active" || user.accountId !== existing.accountId) {
      await this.mobileAuth.revokeFamily(existing.familyId, now, "user_unavailable");
      throw invalidRefresh();
    }
    const grant = await this.db.tx(async () => {
      const at = new Date().toISOString();
      const newId = randomUUID();
      const won = await this.mobileAuth.rotateRefreshToken(existing.id, newId, at);
      if (!won) {
        await this.mobileAuth.revokeFamily(existing.familyId, at, "refresh_token_reused");
        await this.hooks.identity(systemContext("sign-in", existing.accountId), { kind: "mobile_refresh_reused", familyId: existing.familyId });
        return null;
      }
      const refreshToken = opaqueSecret();
      const exchangeCode = opaqueSecret();
      const refreshExpiresAt = new Date(Date.parse(at) + MOBILE_REFRESH_LIFETIME_MS).toISOString();
      const exchangeExpiresAt = new Date(Date.parse(at) + MOBILE_EXCHANGE_TTL_MS).toISOString();
      await this.mobileAuth.insertRefreshToken({
        id: newId,
        familyId: existing.familyId,
        tokenHash: sha256(refreshToken),
        accountId: existing.accountId,
        userId: existing.userId,
        deviceId: existing.deviceId,
        deviceName: existing.deviceName,
        userAgent: clipAgent(client.userAgent) ?? existing.userAgent,
        createdAt: at,
        lastUsedAt: at,
        expiresAt: refreshExpiresAt,
      });
      await this.mobileAuth.insertExchangeCode({
        id: randomUUID(),
        codeHash: sha256(exchangeCode),
        accountId: existing.accountId,
        userId: existing.userId,
        refreshTokenId: newId,
        createdAt: at,
        expiresAt: exchangeExpiresAt,
      });
      return { refreshToken, refreshExpiresAt, exchangeCode, exchangeExpiresAt, user: userView(user), account: accountView(account) };
    });
    if (grant === null) throw invalidRefresh();
    return grant;
  }

  async exchange(body: unknown, client: Pick<ClientOf, "previousToken" | "userAgent">): Promise<Issued> {
    const req = accepted(checkMobileExchange(body));
    const now = new Date().toISOString();
    const consumed = await this.mobileAuth.consumeExchangeCode(sha256(req.code), now);
    if (consumed === null) throw invalidExchange();
    const user = await this.accounts.user(consumed.userId);
    const account = await this.accounts.account(consumed.accountId);
    if (user === null || account === null || user.disabledAt !== null || account.status !== "active" || user.accountId !== consumed.accountId) {
      throw invalidExchange();
    }
    return this.accounts.issue(user, { previousToken: client.previousToken, userAgent: client.userAgent });
  }

  async logout(body: unknown): Promise<{ ok: true }> {
    const req = accepted(checkMobileLogout(body));
    const existing = await this.mobileAuth.byRefreshTokenHash(sha256(req.refreshToken));
    if (existing !== null && existing.deviceId === req.deviceId) {
      await this.mobileAuth.revokeFamily(existing.familyId, new Date().toISOString(), "signed_out");
    }
    return { ok: true };
  }
}
