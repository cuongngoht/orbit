// What CLASS of operation each Satellite command is, so a viewer, a test and a person can tell a look from a write
// without reading code -- and what Satellite NEVER does, said as a list a test holds every table against.
export const OPERATIONS = Object.freeze([
  { id: "SATELLITE_READ", commands: ["mission.context", "mission.show", "mission.events", "mission.list", "agent.envelope", "definitions.list", "definitions.show", "host.capabilities", "host.detect", "settings", "where", "protocol", "live.status", "live.watch", "live.tui", "live.where"], say: "reads the machine store; writes nothing" },
  { id: "MISSION_RECORD", commands: ["mission.start", "mission.step", "mission.finish", "mission.reconcile", "agent.ack", "agent.report"], say: "writes the mission's own journal and artifacts, through the execution gateway" },
  { id: "VIEWER_OPEN", commands: ["live.open"], say: "opens a viewer beside the session; writes only its own launch file" },
]);

export const NOT_SATELLITE = Object.freeze(["MODEL_CALL", "ARBITRARY_SHELL", "PRIMARY_CHECKOUT_WRITE", "ORBIT_TASK_CREATE_FOR_A_MISSION", "ORBIT_JOURNAL_WRITE", "HUMAN_APPROVAL_GRANT", "SETTINGS_WRITE", "SKILL_STATUS_MOVE", "EXECUTABLE_GENERATION", "SECRET_READ", "PACKAGE_INSTALL", "PUSH", "MERGE", "DEPLOY"]);

export const classOf = (command) => OPERATIONS.find((o) => o.commands.includes(command))?.id ?? null;
