# ORBIT-GOV-002 — production is declared, never guessed

`src/protected/environments.mjs` reads every word something that knows may declare about where an action lands (a
person's reach target classification, a QA environment's kind, a capability's own `environment`) onto ONE tier, so a
protected boundary asks "is it production?" in one place. `src/protected/capability.mjs` describes a capability call
as the action its declarations say it is, and `src/protected/authorize.mjs` decides that action.

The behaviour this source must have:

- `tierOf(word)` reads each word Orbit accepts onto its tier: `production`; `staging`; `preview`; `development` and
  `shared-development` onto development; `test`; `local`, `sandbox` and `task-isolated` onto local. A declaration is read
  the way a person writes it: its letter case and the whitespace around it change nothing (`PRODUCTION`,
  ` production `, `Staging` are declarations of production and staging).
- A word nobody listed -- `prod`, `live`, `production-eu`, `external-readonly`, an empty, blank or missing declaration,
  a number -- is `unknown`, and unknown is never production: a target is not production because it looks remote or
  important, only because something that knows declared it so.
- `isProduction(word)` is true exactly when `tierOf(word)` is `production`.
- `strictestTier(words)` is the strictest tier any of the declarations names, in the order production, staging,
  preview, development, test, local: whichever source says production wins. It is `unknown` only when none of them
  names a known tier, and for no declarations at all.
- `capabilityAction(cap, input)` lands a capability where its declarations say: a capability whose inputs `bind` to a
  task's sandbox lands there (`local`) unless it also declares production, and then the strictest declaration wins; one
  that declares nothing, or a word nobody listed, lands nowhere known. So `authorize` asks a person for a production
  deploy, migration, destructive operation (`delete`, `truncate`, `drop`, `purge`, `reset`) or a mutating capability
  that declares no effect, and lets a read or a declared write on production, and anything of the kind anywhere not
  declared production, run on its own.

Make the smallest change in `src/protected/` that gives this behaviour, and add a regression test under `test/` that
fails before your change and passes after it. Do not change or delete an existing test.
