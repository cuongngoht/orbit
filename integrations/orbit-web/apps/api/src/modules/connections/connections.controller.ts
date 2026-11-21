// SETTINGS → AI CONNECTIONS, as routes -- the account owner's, every one (the gate holds each to a browser session of
// the account, and a change to that session's CSRF token). The account is always the session's: another account's
// connection is not found.
//
//   GET    /api/connections                      what is installed, the account's connections, the methods offered,
//                                                and whether it can hire (a connected connection with its own catalog)
//   POST   /api/connections                      { runtime, method, label?, apiKey?, cloud? } -> 201
//   GET    /api/connections/:id
//   PATCH  /api/connections/:id                  { label?, isDefault?: true, apiKey? } with If-Match: "<version>"
//   POST   /api/connections/:id/check            its CLI asked now
//   POST   /api/connections/:id/disconnect       the CLI's own logout, the home's login removed
//   DELETE /api/connections/:id                  -> 204 (409 connection_in_use while an employee runs on it)
//   PUT    /api/connections/:id/plugins/orbit    { useCase, approved, digest } -- Claude Code only
//
//   GET    /api/claude/models                    the account's models: its default Claude Code connection's catalog
//   GET    /api/claude/connectors                its claude.ai connectors and MCP servers, with the account's choices
//   POST   /api/claude/connectors/refresh        read again from its connection's CLI
//   PUT    /api/claude/connectors                the account's choices
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Req } from "@nestjs/common";
import { checkUpdateConnectors, type AiConnectionsView, type ConnectorList, type ModelCatalog, type RuntimeConnection } from "@orbit-web/contracts";
import type { Request } from "express";
import { accepted } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { PrincipalResolver } from "../auth/principals.js";
import { ClaudeConnectorsService } from "./claude-connectors.service.js";
import { ClaudeModelsService } from "./claude-models.service.js";
import { ConnectionsService } from "./connections.service.js";

const ifMatchOf = (req: Request): string | undefined => {
  const v = req.headers["if-match"];
  return Array.isArray(v) ? v[0] : v;
};

@Controller("connections")
export class ConnectionsController {
  constructor(
    @Inject(ConnectionsService) private readonly connections: ConnectionsService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
  ) {}

  @Get()
  list(): Promise<AiConnectionsView> {
    return this.connections.view(viewer());
  }

  @Post()
  @HttpCode(201)
  create(@Req() req: Request, @Body() body: unknown): Promise<RuntimeConnection> {
    return this.connections.create(viewer(), this.principals.context(req), body);
  }

  @Get(":id")
  one(@Param("id") id: string): Promise<RuntimeConnection> {
    return this.connections.one(viewer(), id);
  }

  @Patch(":id")
  update(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<RuntimeConnection> {
    return this.connections.update(viewer(), this.principals.context(req), id, body, ifMatchOf(req));
  }

  @Post(":id/check")
  @HttpCode(200)
  check(@Req() req: Request, @Param("id") id: string): Promise<RuntimeConnection> {
    return this.connections.check(viewer(), this.principals.context(req), id);
  }

  @Post(":id/disconnect")
  @HttpCode(200)
  disconnect(@Req() req: Request, @Param("id") id: string): Promise<RuntimeConnection> {
    return this.connections.disconnect(viewer(), this.principals.context(req), id);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Req() req: Request, @Param("id") id: string): Promise<void> {
    await this.connections.remove(viewer(), this.principals.context(req), id);
  }

  @Put(":id/plugins/orbit")
  plugin(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<RuntimeConnection> {
    return this.connections.setPlugin(viewer(), this.principals.context(req), id, body);
  }
}

@Controller("claude")
export class ClaudeController {
  constructor(
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(ClaudeConnectorsService) private readonly connectors: ClaudeConnectorsService,
  ) {}

  @Get("models")
  catalog(): Promise<ModelCatalog> {
    return this.models.catalog(viewer().accountId);
  }

  @Get("connectors")
  connectorList(): Promise<ConnectorList> {
    return this.connectors.list(viewer().accountId);
  }

  @Post("connectors/refresh")
  @HttpCode(200)
  refreshConnectors(): Promise<ConnectorList> {
    return this.connectors.list(viewer().accountId, true);
  }

  @Put("connectors")
  updateConnectors(@Body() body: unknown): Promise<ConnectorList> {
    return this.connectors.update(viewer().accountId, accepted(checkUpdateConnectors(body)));
  }
}
