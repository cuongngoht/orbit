// A task may cross a process boundary through stdin; never echo its text on
// parse failure. The old argv interface remains for existing callers.
export function taskArguments(argv, read) {
  if (!argv.includes('--for-stdin')) return argv;
  return [...argv.filter((a) => a !== '--for-stdin' && !a.startsWith('--for=')), `--for=${String(read()).slice(0, 16384)}`];
}
