// A generated playbook as a host would write it -- and its hostile variants, one per rule it must trip.
// The playbook names only Orbit commands its CLI's own usage header documents, and reads nothing it does not need.
export const PLAYBOOK_ID = "release-checklist-verification";

export const GOOD = `---
name: ${PLAYBOOK_ID}
description: Verify this project's release checklist with the Orbit commands it already has, and say what still needs a person.
user-invocable: false
---

# Release checklist verification

1. Check the test data is clean:

\`\`\`bash
node <engine>/cli/query.mjs check
node <engine>/cli/plan-check.mjs every
\`\`\`

2. Read the workflow's engineering task and its verification:

\`\`\`bash
node <engine>/cli/task.mjs show
\`\`\`

3. Report each checklist row as checked, failed or needs a person. Never mark a row checked without its output.
`;

export const manifestFor = (needs = ["project.context", "repository.read"]) => ({ schema: 2, shape: "verification", inputs: "project context and the release checklist", outputs: "checked checklist with evidence", evidence: "owner-record", restrictions: "instruction-only; never executes generated code", id: PLAYBOOK_ID, origin: "generated", scope: "project", provides: ["release.checklist.verification"], needs, workflow: "orbit-help", allowedTools: ["Read"], generationReason: "nothing here provides the release checklist workflow", engine: ">=1.0.0" });
