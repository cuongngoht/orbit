import { intakeFromText, persistIntake } from "./intake.mjs";

export function startGoal(ports, text, opts = {}) {
  const intake = intakeFromText(ports.ctx, text, opts);
  return ports.goals.transact(intake.id, () => {
    persistIntake(ports.goals, ports.io, intake);
    return { id: intake.id, title: intake.title, specDigest: intake.spec.digest };
  });
}
