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
import { accessGate, hostGuard, mutationGuard, securityHeaders } from "./infra/security/guards.js";

export const BODY_LIMIT = "256kb";

export function configureApp(app: NestExpressApplication, config: AppConfig): NestExpressApplication {
  app.disable("x-powered-by");
  app.set("etag", false);
  app.use(hostGuard(config));
  app.use(securityHeaders());
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), { bodyParser: false, logger: new Logger() });
  return configureApp(app, config);
}
