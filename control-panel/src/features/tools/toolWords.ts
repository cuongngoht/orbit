export const TOOLS_PATH = "/tools";
export const toolPath = (id: string) => `${TOOLS_PATH}/${encodeURIComponent(id)}`;

// Where a tool was found, in a person's words. The order of detection is the
// server's (src/tools/detect.mjs SOURCES); this only names them.
export const SOURCE_LABEL: Record<string, string> = {
  project: "Project",
  "orbit-managed": "Orbit Managed",
  system: "System",
  override: "ORBIT_CONTROL_NODE",
  running: "The running Node",
  nvm: "nvm",
};
