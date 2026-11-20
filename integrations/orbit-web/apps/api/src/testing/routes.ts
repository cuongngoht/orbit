// Every route the running application declares, read from Nest's own metadata -- for the tests that hold a rule over
// every route at once (the Claude sign-in gate, the chat and research access gates), so a route added later is held too.
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { ModulesContainer } from "@nestjs/core";
import { BEFORE_CLAUDE_SIGN_IN } from "../common/before-claude-sign-in.js";
import type { Harness } from "./harness.js";

export interface Route {
  method: string;
  path: string;
  // Marked reachable before the Claude sign-in.
  open: boolean;
}

const pathsOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [String(v ?? "")]);
const joined = (...parts: string[]): string => `/api/${parts.map((p) => p.replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/")}`;

export function routesOf(h: Harness): Route[] {
  const routes: Route[] = [];
  for (const module of h.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as { prototype: Record<string, unknown> } | null;
      if (!controller) continue;
      const classOpen = Reflect.getMetadata(BEFORE_CLAUDE_SIGN_IN, controller) === true;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (name === "constructor" || typeof handler !== "function" || Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] as string;
        const open = classOpen || Reflect.getMetadata(BEFORE_CLAUDE_SIGN_IN, handler) === true;
        for (const base of pathsOf(Reflect.getMetadata(PATH_METADATA, controller))) for (const own of pathsOf(Reflect.getMetadata(PATH_METADATA, handler))) routes.push({ method, path: joined(base, own), open });
      }
    }
  }
  return routes;
}

// A route's path with each parameter filled in.
export const filled = (path: string, values: Record<string, string>): string => path.replace(/:([A-Za-z]+)/g, (_, name: string) => values[name] ?? "00000000-0000-4000-8000-000000000000");
