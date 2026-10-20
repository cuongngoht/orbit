# Orbit (Claude Code)

Product identity, invariants, DSL rules, Five Lines constraints, and definition of done are in [AGENTS.md](AGENTS.md).

@AGENTS.md

Module map: [docs/agents/layout.md](docs/agents/layout.md). Extension table: [docs/agents/extend.md](docs/agents/extend.md).

## Claude Code

```bash
/plugin marketplace add cuongngoht/orbit
/plugin install orbit@orbit
```

Local: `claude --plugin-dir .`

Host session hints (untrusted): plugin option `host_memory`, or `ORBIT_HOST_MEMORY=off`.
