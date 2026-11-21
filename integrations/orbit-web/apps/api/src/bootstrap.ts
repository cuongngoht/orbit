// Builds the Nest application around a module tree: the guards first (before any route or file), then the JSON
// body parser with its size limit, the API under /api, the built web app at /, and graceful shutdown.
import "reflect-metadata";
import { type INestApplication, Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AppModule } from "./app.module.js";
import { ApiExceptionFilter } from "./common/errors.js";
import type { AppConfig } from "./config/config.js";
import { requestScope } from "./common/request-scope.js";
import { accessGate, hostGuard, mutationGuard, noStore, securityHeaders } from "./infra/security/guards.js";

export const BODY_LIMIT = "256kb";

// How the Nest application is made, in production and in the tests alike. `forceCloseConnections`: a stop ends the
// connections still open -- the streams a page holds (it reconnects to the next start from the last event it saw).
// Without it the HTTP server waits for them for ever, so the shutdown hooks after it never run (the databases are
// never closed) and the container is killed when its grace period runs out. The runs are stopped before that, by
// their own `beforeApplicationShutdown`.
export const NEST_OPTIONS = { bodyParser: false, forceCloseConnections: true } as const;

export function configureApp(app: NestExpressApplication, config: AppConfig): NestExpressApplication {
  app.disable("x-powered-by");
  app.set("etag", false);
  // Routes match as written: `/API/sessions` is no route at all (the guards decide on the routed path as well).
  app.set("case sensitive routing", true);
  app.set("strict routing", true);
  app.use(requestScope());
  app.use(hostGuard(config));
  app.use(securityHeaders());
  app.use(noStore());
  app.use(accessGate(config));
  app.use(mutationGuard());
  app.useBodyParser("json", { limit: BODY_LIMIT });
  app.setGlobalPrefix("api");
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();
  if (config.webDist !== null && existsSync(join(config.webDist, "index.html"))) {
    app.useStaticAssets(config.webDist, {
      index: "index.html",
      setHeaders: (res, path) => res.setHeader("Cache-Control", path.includes(`${"/"}assets${"/"}`) ? "public, max-age=31536000, immutable" : "no-cache"),
    });
  }
  return app;
}

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { ...NEST_OPTIONS, logger: new Logger() });
  return configureApp(app, config);
}
