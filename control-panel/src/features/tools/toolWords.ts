export const TOOLS_PATH = "/tools";
export const toolPath = (id: string) => `${TOOLS_PATH}/${encodeURIComponent(id)}`;

// A tool the catalog lets Orbit fetch for itself (`autonomous`): the pinned copy a task may bring in when it needs the tool, which is the
// same copy Install puts in place now.
export const FETCHES_ITSELF = "Orbit fetches its own pinned copy when a task needs it; Install does the same now.";

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
