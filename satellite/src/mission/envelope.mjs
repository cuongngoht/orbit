// The envelope of ONE agent run, rebuilt from the journal and the pinned definitions every time it is asked -- so the
// dispatch step, `agent envelope` and a resumed session hand the host exactly the same thing.
import { envelopeOf } from "../hosts/envelope.mjs";
import { readHandoff } from "../handoff/handoff.mjs";
import { list, quietly } from "../store/text.mjs";

const playbookOf = (ports, record) => (record?.content?.orbitPin ? quietly(() => ports.factory?.playbook?.(record.content.orbitPin).files.map((f) => `## ${f.name}\n${f.text}`).join("\n\n")) : null);

const skillsOf = (ports, run) => list(run.skillPins).map((pin) => ((record) => ({ pin, capability: record?.content?.capability ?? null, playbook: playbookOf(ports, record) }))(quietly(() => ports.definitions.read(pin))));

const consumedBy = (ports, lw, runId) => [...lw.m.handoffs.values()].filter((h) => h.consumed.some((c) => c.agentRun === runId)).map((h) => readHandoff(ports.io, ports.rooms, lw.id, h.id)).filter(Boolean);

const criteriaOf = (m, unit) => list(m.intent?.acceptanceCriteria).filter((c) => list(unit.acceptanceCriteriaRefs).includes(c.id)).map((c) => ({ id: c.id, statement: c.statement, verification: c.verification ?? null }));

export function envelopeFor(ports, lw, runId) {
  const run = lw.m.runs.get(runId);
  const unit = lw.m.units.get(run.unit);
  const role = ports.definitions.read(run.rolePin);
  const template = ports.definitions.read(run.templatePin);
  return envelopeOf({ m: lw.m, run, unit, role, template, skills: skillsOf(ports, run), handoffs: consumedBy(ports, lw, runId), criteria: criteriaOf(lw.m, unit), hostRow: ports.hostRow, roots: ports.roots });
}
