# Custom Harness Instructions

## Policy

Follow higher-priority instructions and this repository's existing policy before `.harness/config.toml`. Never read secrets or `.env` files. Preserve user changes and stop on scope uncertainty.

## Workflow

The leader classifies work as `small`, `medium`, or `large`, records `.harness/task-status.json` as `in-progress`, and coordinates without implementing. Delegate changes to `.agents/implementer.md`; request independent review through `.agents/reviewer.md`.

Run the configured cycle: `init → analysis → implementation → tests → reviewer → corrections → final init`. Only the leader may set `done`, after reviewer approval and final validation.

At approximately 40% remaining context, update `.harness/context/task-context.toon` with objective, decisions, files, tests, blockers, and next steps.

Do not commit, publish, or mutate external state unless explicitly authorized.
