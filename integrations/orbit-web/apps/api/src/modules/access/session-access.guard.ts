// THE CHAT ACCESS GATE: every route under /api/sessions/<id> -- the chat, its messages, its stream, its changes, its
// project, its share, its push -- answers only an account that may open that chat (its owner, or one it was shared
// with); for any other the chat does not exist (404). Deleting it, sharing it on and making a public link of it are its
// owner's. It is a GLOBAL guard over the routed path, so a route added later under a chat is held too. Before the
// Claude sign-in it lets the sign-in gate answer (401).
import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { routedPath } from "../../infra/security/guards.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { OwnershipService, type Need } from "./ownership.service.js";

const SESSION_ROUTE = /^\/api\/sessions\/([^/]+)(\/.*)?$/;

// What only the owner does: delete the chat, choose who it is shared with, make or remove its public link.
const OWNER_ROUTES: { method: string; rest: string }[] = [
  { method: "DELETE", rest: "" },
  { method: "PUT", rest: "/access" },
  { method: "POST", rest: "/share" },
  { method: "DELETE", rest: "/share" },
];

export const needOf = (method: string, rest: string): Need => (OWNER_ROUTES.some((r) => r.method === method && r.rest === rest) ? "owner" : "open");

@Injectable()
export class SessionAccessGuard implements CanActivate {
  constructor(
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const req = context.switchToHttp().getRequest<Request>();
    const match = SESSION_ROUTE.exec(routedPath(req.path));
    if (match === null) return true;
    if ((await this.claude.account()).state !== "connected") return true;
    this.ownership.require(match[1] as string, await this.ownership.viewer(), needOf(req.method, (match[2] ?? "").replace(/\/+$/, "")));
    return true;
  }
}
