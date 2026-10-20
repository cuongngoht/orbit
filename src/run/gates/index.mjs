// The gates a run passes before it touches the browser, in order. Each either
// returns or throws Refused; adding a gate is adding a file and a line here.
//
// `page` marks a gate that ASKS the browser. It applies only when the run needs
// a page (src/dsl/page.mjs): a case of sql and call steps whose capabilities
// declared page: false has no browser to ask and needs none. A run that never
// said (`run.page` unset) is taken to need one.
import { apiWatermarkGate } from "./api-watermark.mjs";
import { bindingGate } from "./bindings.mjs";
import { destructiveGate } from "./destructive.mjs";
import { identityGate } from "./identity.mjs";
import { originGate } from "./origin.mjs";
import { sessionGate } from "./session.mjs";
import { staleGate } from "./stale.mjs";
import { startScreenGate } from "./start-screen.mjs";

export const GATES = [
  { gate: destructiveGate },
  { gate: bindingGate },
  { gate: apiWatermarkGate },
  { gate: staleGate },
  { gate: originGate, page: true },
  { gate: sessionGate, page: true },
  { gate: identityGate, page: true },
  { gate: startScreenGate, page: true },
];

export function passGates(ctx, run) {
  for (const row of GATES.filter((g) => !g.page || run.page !== false)) row.gate(ctx, run);
}
