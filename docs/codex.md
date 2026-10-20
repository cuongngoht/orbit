# Codex setup

The additive `.codex-plugin/plugin.json` shares `./skills/` and explicitly loads `./hooks/codex.json`. The repository marketplace `.agents/plugins/marketplace.json` points to the shared root. Claude's package remains separate; no global executable is installed.

Register/install through the target Codex version's native plugin commands, then review and trust the hooks. Installation does not establish hook trust. Measured on Codex 0.163.0 (0.0.2), from a checkout or an unpacked release:

```sh
codex plugin marketplace add <plugin-root>
codex plugin add orbit@orbit
```

Hook trust is kept per hook by hash, so a reinstall whose hooks did not change asks nothing again. 0.163.0 delivered SessionStart (both hooks) and UserPromptSubmit (the router) in a headless `codex exec`; its tool, Stop and SessionEnd payloads were not captured for 0.0.2, so the 0.157.1 captures remain the fixtures. Enable only one Orbit installation per workspace. Use [root/session binding](hosts.md#root-and-session-binding) on each command. Translate historical Claude examples to the actual installed skill root; Claude's frontmatter/allowed-tools remain intact.

AGENTS.md in this repository exceeds Codex's default instruction budget. Configure `project_doc_max_bytes` for the actual file size plus nested instructions, or use a short instruction index with explicit references in consuming projects. Do not assume the entire file was loaded.

Native acceptance must capture startup context, prompt routing, pre/post tool delivery, unknown Bash outcomes, Stop checkpoint, SessionEnd timing, retry and uninstall in an isolated consuming checkout/store. Orbit Control must be stopped during the smoke run. Native agents, unverified read/search mappings and native memory remain unavailable.

Sources: [hooks](https://developers.openai.com/codex/hooks), [packaging](https://developers.openai.com/plugins/build/plugins), [AGENTS guidance](https://developers.openai.com/codex/guides/agents-md).
