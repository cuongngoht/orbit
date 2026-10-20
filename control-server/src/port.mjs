// The port Orbit Control listens on, read from its arguments and nothing else.
//
// Two spellings say the same thing: `--port=<n>`, and `--port <n>` as two words. The second is how a
// task's sandbox tells a component its port when a person set an argument override for it (README:
// Sandboxes), because a launch adds the flag and the port as SEPARATE argument words. No argument is
// port 0, where the OS picks a free one. Anything else is bad usage, never a guess.
export const USAGE = "usage: node control-server/src/main.mjs [--port=<n> | --port <n>]   (default 0: the OS picks a free port)";

// Ordered; an argument list no row reads is bad usage.
const FORMS = [
  { when: (argv) => argv.length === 0, text: () => "0" },
  { when: (argv) => argv.length === 1 && argv[0].startsWith("--port="), text: (argv) => argv[0].slice("--port=".length) },
  { when: (argv) => argv.length === 2 && argv[0] === "--port", text: (argv) => argv[1] },
];

const DIGITS = /^\d{1,5}$/;

// -> the port, 0-65535; throws USAGE (main.mjs exits 2) for anything else.
export function portOf(argv) {
  const form = FORMS.find((f) => f.when(argv));
  if (!form) throw new Error(USAGE);
  const text = form.text(argv);
  if (!DIGITS.test(text) || Number(text) > 65535) throw new Error(`--port must be 0-65535\n${USAGE}`);
  return Number(text);
}
