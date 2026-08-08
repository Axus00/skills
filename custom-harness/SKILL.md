---
name: custom-harness
description: Install, adapt, or review a reusable multi-agent repository harness with small/medium/large classification, non-implementing leader, implementer/reviewer separation, validation gates, task status, and context checkpoints. Use when Codex needs to bootstrap or migrate agent orchestration for Codex, Claude Code, or Cursor; make consumer policies configurable; or design synchronized npm and NuGet distribution without publishing.
---

# Custom Harness

## Workflow

1. Inspect the target repository instructions, existing agent files, validation commands, and working-tree changes. Never read secrets or `.env` files.
2. Read [architecture.md](references/architecture.md) and [configuration.md](references/configuration.md). Read [adapters.md](references/adapters.md) for each requested platform and [distribution.md](references/distribution.md) only for packaging or release work.
3. Resolve policy in this order: system and user instructions, consumer repository instructions, optional harness configuration, safe defaults. Never weaken a higher-priority rule.
4. Classify the task as `small`, `medium`, or `large`; let the leader record `in-progress`, delegate implementation, and preserve user changes.
5. Preview installation before writing:

   ```bash
   python3 scripts/install_harness.py --target /path/to/repo --platform codex --dry-run
   ```

6. Install one or more adapters. Stop on collisions and merge them manually; use `--force` only with explicit authorization because it replaces files after creating backups.
7. Run consumer build/tests plus:

   ```bash
   python3 scripts/validate_harness.py --target /path/to/repo --platform codex
   ```

8. Request independent reviewer approval, apply corrections through the implementer, run the final init, and only then let the leader set `done`.

## Invariants

- Keep the leader orchestration-only; it must not implement or self-approve.
- Preserve `init → analysis → implementation → tests → reviewer → corrections → final init`.
- Keep task state and the context checkpoint repository-local and free of secrets.
- Treat unavailable native subagents as a documented degraded mode, not as equivalent isolation.
- Keep project-specific commands, paths, permissions, languages, and release rules in consumer policy.
- Make installation idempotent, preflight all writes, and support `--dry-run`.
- Do not commit, publish, or mutate external systems without explicit authorization.
