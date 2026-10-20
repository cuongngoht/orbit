// Read-only visibility; hooks never depend on this server being present.
import { hostsView, catalogFile, readCatalog, optionEnvironment } from '../core.mjs';
export function agenticHosts(ctx) {
  const world = ctx.world;
  const catalog = readCatalog(world.io, catalogFile(world.pluginRoot, 'hosts'));
  return { version: 1, hosts: hostsView(catalog.hosts, world.rooms, world.io, (id) => optionEnvironment(world.env ?? {}, id)) };
}
