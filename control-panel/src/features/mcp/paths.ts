export const MCP_PATH = "/mcp";
export const MCP_EXTERNAL = `${MCP_PATH}/external`;
export const MCP_CATALOG = `${MCP_PATH}/catalog`;
export const MCP_POLICIES = `${MCP_PATH}/policies`;
export const MCP_NEW = `${MCP_PATH}/new`;

// An external server's id may be `plugin:<plugin>:<name>`, so every id is encoded.
export const managedPath = (id: string) => `${MCP_PATH}/managed/${encodeURIComponent(id)}`;
export const managedEditPath = (id: string) => `${managedPath(id)}/edit`;
export const externalPath = (id: string) => `${MCP_EXTERNAL}/${encodeURIComponent(id)}`;
/** "Add to Orbit" from an external server: the form, prefilled from what the host shows. */
export const fromExternalPath = (id: string) => `${MCP_NEW}?from=${encodeURIComponent(id)}`;
