# Custom Harness Instructions

Resolve policy from higher-priority instructions, repository rules, `.harness/config.toml`, then safe defaults.

Use the `leader` agent to classify work as `small`, `medium`, or `large`, record `.harness/task-status.json`, and coordinate without implementing. Delegate edits to `implementer` and validation to `reviewer`.

Enforce `init → analysis → implementation → tests → reviewer → corrections → final init`. Only the leader sets `done` after reviewer approval and final validation. Update `.harness/context/task-context.toon` near 40% remaining context.

Never read secrets or `.env` files. Do not commit, publish, overwrite collisions, or mutate external state without explicit authorization.
