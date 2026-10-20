# Grok Build setup

Orbit runs in Grok Build (xAI's `grok` CLI) as a protocol-2 host, measured on grok 1.0.62: the same `./skills/`, its
own hooks file (`hooks/grok.json`) and an adapter mapped from Grok's real hook payloads
(`skills/orbit-learn/hosts/grok.mjs`). Claude's, Codex's and Antigravity's packages are unchanged.

Install from the repository itself, and let Grok trust the plugin so its hooks run:

```sh
grok plugin install cuongngoht/orbit --trust    # or a local clone: grok plugin install /path/to/orbit --trust
grok plugin details orbit                                # skills, 0 agents, hooks
```

Grok reads the manifest at the repository root (`plugin.json`) before `.grok-plugin/` or `.claude-plugin/`. That file
is Antigravity's too, so it carries two keys only Grok reads: `hooks` names `./hooks/grok.json` -- without it Grok
would fall back to `hooks/hooks.json`, Claude's file, whose `if` handlers it skips -- and an empty `agents` keeps Orbit's
Claude-tuned agents out, because native agents are unavailable until verified. Antigravity ignores both keys:
`agy plugin validate .` reports them as warnings and passes. A marketplace whose plugin is the repository root offers
nothing in grok 1.0.62, so the repository is installed directly rather than through `grok plugin marketplace add`.

Nothing has to be bound by hand: the shell Grok gives its agent's tools carries `GROK_SESSION_ID`, and every Orbit command
run there binds itself to the session ([root/session binding](hosts.md#root-and-session-binding)). Grok's SessionStart
output reaches only the person and it drops an allowing UserPromptSubmit hook's output, so no startup recall and no
router advice reach the model; `/orbit-help` and the commands it runs carry what the model needs.

Native acceptance must still capture hook delivery with the plugin installed and trusted, a command's exit code reaching
the working set, the Stop and SessionEnd checkpoints within Grok's 1.5-second plugin SessionEnd budget, the drain, and
uninstall preserving the store, in an isolated consuming checkout with Orbit Control stopped. Grok has reported plugin
hooks that load but are not dispatched (xai-org/plugin-marketplace issue 236); a smoke that sees no hook line names
that, never a Orbit failure guessed from silence.

Sources: `~/.grok/docs/user-guide/09-plugins.md` and `10-hooks.md` as shipped with grok 1.0.62, and the payloads in
`test/fixtures/hooks/grok-v2/`.
