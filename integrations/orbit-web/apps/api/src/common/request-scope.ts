// THE REQUEST'S OWN SCOPE: who this request is from, as the auth guard established it, reachable from any service the
// request calls without threading it through every signature. It lives exactly as long as the request: work that
// outlives it (a run started by it, a timer) finds no viewer there -- it acts for the account its own records name,
// never for whoever happens to have asked last.
import { HttpStatus } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { SIGN_IN_REQUIRED } from "@orbit-web/contracts";
import type { Owner, Principal } from "../modules/auth/principal.js";
import { ApiError } from "./errors.js";

interface Scope {
  principal: Principal | null;
  correlationId: string;
  ended: boolean;
}

const scopes = new AsyncLocalStorage<Scope>();

export function requestScope() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const scope: Scope = { principal: null, correlationId: randomUUID(), ended: false };
    const end = () => (scope.ended = true);
    res.on("finish", end);
    res.on("close", end);
    scopes.run(scope, next);
  };
}

const live = (): Scope | null => {
  const s = scopes.getStore();
  return s === undefined || s.ended ? null : s;
};

// The auth guard's word on this request.
export function setPrincipal(principal: Principal): void {
  const s = live();
  if (s !== null) s.principal = principal;
}

export const currentPrincipal = (): Principal | null => live()?.principal ?? null;

export const currentCorrelation = (): string => live()?.correlationId ?? randomUUID();

// The person whose browser made this request: the owner of the account its session is for.
export function viewerOrNull(): Owner | null {
  const p = currentPrincipal();
  return p !== null && p.kind === "owner" ? p : null;
}

export function viewer(): Owner {
  const v = viewerOrNull();
  if (v === null) throw new ApiError(HttpStatus.UNAUTHORIZED, SIGN_IN_REQUIRED, "Sign in to Orbit Web first.");
  return v;
}
