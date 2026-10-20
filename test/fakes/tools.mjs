// A Tools port that probes nothing. `present` maps a command name to whether it
// is usable here, so a doctor test can describe a machine instead of being run
// on one -- the point being that the interesting machines are the ones this
// suite is not running on.
export function fakeTools(answers = {}, installs = {}) {
  const asked = [];
  const installed = [];
  const present = (bin) => { asked.push(bin); return answers[bin] ?? { ok: false, why: "not found on PATH" }; };
  const install = (pkg) => { installed.push(pkg); return installs[pkg] ?? { ok: true }; };
  return { asked, installed, present, install };
}
