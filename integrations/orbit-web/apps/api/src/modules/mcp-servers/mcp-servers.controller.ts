// /api/mcp-servers: the account's MCP servers (Settings → MCP servers), read and changed by a signed-in person of the
// account -- added, renamed, its tools allowed, its sign-in replaced, read again, removed. No route says a credential.
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from "@nestjs/common";
import type { McpServerList, McpServerView } from "@orbit-web/contracts";
import { ownerActor } from "../../contexts/shared/application/commands.js";
import { McpRegistry } from "./mcp-registry.js";

@Controller("mcp-servers")
export class McpServersController {
  constructor(@Inject(McpRegistry) private readonly registry: McpRegistry) {}

  @Get()
  list(): Promise<McpServerList> {
    return this.registry.list(ownerActor().command.orbitId);
  }

  @Post()
  @HttpCode(201)
  add(@Body() body: unknown): Promise<McpServerView> {
    return this.registry.add(ownerActor(), body);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() body: unknown): Promise<McpServerView> {
    return this.registry.update(ownerActor(), id, body);
  }

  @Post(":id/refresh")
  @HttpCode(200)
  refresh(@Param("id") id: string): Promise<McpServerView> {
    return this.registry.refresh(ownerActor(), id);
  }

  @Delete(":id")
  remove(@Param("id") id: string): Promise<McpServerList> {
    return this.registry.remove(ownerActor(), id);
  }
}
