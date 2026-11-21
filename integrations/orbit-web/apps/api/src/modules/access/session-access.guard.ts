// THE CHAT ACCESS CHECK: every route under /api/sessions/<id> -- the chat, its messages, its stream, its changes, its
// project, its share, its push -- answers only an owner whose account may open that chat (its own, or one shared with
// its identity's email); for any other the chat does not exist (404). Deleting it, sharing it on and making a public
// link of it are its owner account's. It is held by the one global gate (auth.guard.ts, `resourceCheck`) over the
// routed path, after the gate established the owner -- so a route added later under a chat is held too.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { Request } from "express";
import { routedPath } from "../../infra/security/guards.js";
import { AuthHooks } from "../auth/auth-hooks.js";
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
export class SessionAccessCheck implements OnModuleInit {
  constructor(
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  onModuleInit(): void {
    this.hooks.resourceCheck(async (req: Request, owner) => {
      const match = SESSION_ROUTE.exec(routedPath(req.path));
      if (match === null) return;
      await this.ownership.require(match[1] as string, owner, needOf(req.method, (match[2] ?? "").replace(/\/+$/, "")));
    });
  }
}
