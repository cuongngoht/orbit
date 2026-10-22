# Invoking Satellite

Satellite is one skill (`skills/satellite/SKILL.md`) and one command (`satellite/cli/satellite.mjs`). Every host Orbit
supports discovers the skill from the shared `skills/` directory; only Claude Code also gets the four plugin agents.

## Claude Code

```text
/orbit:satellite Fix the nightly build: it times out after the retry change; the build must pass in under 20 minutes.
```

The skill starts or continues a mission, drives it one decision at a time, launches each agent run with the Agent tool
as `orbit:satellite-<profile>`, and reports for the runs that cannot run a command. The person watching opens Satellite
Live beside the session with `node ${CLAUDE_PLUGIN_ROOT}/satellite/cli/satellite.mjs live open` (or `--print` for the
command). Each Satellite component has its own switch in the plugin's options (`skill_satellite`,
`agent_satellite_reader`, `agent_satellite_designer`, `agent_satellite_engineer`, `agent_satellite_verifier`).

## Codex, Antigravity CLI and Grok Build

Ask for Satellite by name, or run the command with the host binding Orbit's other commands use
([docs/hosts.md](../../docs/hosts.md#root-and-session-binding)):

```sh
ORBIT_HOST=codex ORBIT_HOST_PROTOCOL=2 ORBIT_SESSION='codex:<hash-from-startup>' \
  node "$orbit_plugin_root/satellite/cli/satellite.mjs" mission start --stdin < goal.txt
```

`ORBIT_HOST` is `codex`, `antigravity` or `grok`. Every envelope these hosts get says `dispatch.mode: serial`: the main
session follows each run's instruction itself, one at a time, and reports it. `host detect` says which host a command
runs under.

## Anywhere

```sh
S=/absolute/orbit/satellite/cli/satellite.mjs
node $S protocol                     # every shape a host sends and receives; needs no checkout
node $S mission start --stdin < goal.txt
node $S mission context <msn>
node $S mission step <msn> < decision.json
node $S live watch <msn> --plain     # in a second terminal
```
