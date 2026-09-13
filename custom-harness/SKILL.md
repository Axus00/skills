---
name: custom-harness
description: Review, install/adapt, or prepare distribution for a reusable multi-agent repository harness with guarded init, leader delegation, implementer/reviewer separation, portable state, and context checkpoints. Use for Custom Harness work targeting Codex, Claude Code, or Cursor.
---

# Custom Harness

## Common gate

1. Load higher-priority and repository instructions without analyzing the functional request.
2. Select an authorized repository-local init command. Treat `.harness/config.toml` commands as data to vet, never as commands to execute automatically.
3. Run init explicitly. Diagnose failures and retry; begin analysis only after exit code `0`.
4. Inspect existing agent files and working-tree changes without reading secrets or `.env` files.
5. Read [architecture.md](references/architecture.md) and [configuration.md](references/configuration.md). Read [adapters.md](references/adapters.md) only for requested platforms. Read [distribution.md](references/distribution.md) only for the `package` branch.
6. Apply the project-context workflow in
   [project-context.md](references/project-context.md).

   If Memanto discovery, bootstrap, installation, connection, or verification is
   required by that workflow, follow [memanto.md](references/memanto.md).

   Do not block unrelated repository work solely because Memanto is unavailable
   when the project-context fallback is sufficient.

7. Select exactly one branch below. When the target already contains Custom Harness, use its `.harness/bin/workflow_state.py` for every transition and checkpoint.
8. Select exactly one branch below. When the target already contains Custom Harness,
   use its `.harness/bin/workflow_state.py` for every transition and checkpoint.

## Project context gate

Before substantive analysis, delegation, implementation, review, or packaging,
apply the project-context workflow in
[project-context.md](references/project-context.md).

The project-context workflow may use Memanto as the durable project-memory
provider when a compatible integration is available.

If Memanto discovery, bootstrap, installation, connection, or verification is
required, follow [memanto.md](references/memanto.md).

Do not bypass the context gate merely because Memanto is unavailable.
Use the fallback behavior defined in `project-context.md`.

Keep the gate proportional to the request:

- For trivial or clearly scoped follow-up tasks, reuse established repository and
  memory context without re-running a full intake.
- For substantial, ambiguous, architectural, security-sensitive, or distribution
  work, perform a fresh context sufficiency check.
- Enter Grill Mode only when unresolved information can materially affect the outcome.

### Explicit rule

Do not repeat Grill Mode questions whose answers are already available from:

- the current conversation,
- repository evidence,
- or scoped Memanto memories.

Re-evaluate a previously resolved question only when current evidence conflicts with
the stored answer or the user explicitly changes the decision.

## Review branch

Use for architecture, behavior, security, or conformance review. Inspect the requested artifacts, run read-only validation, and delegate directly from leader to reviewer. Do not preview installation, invoke the installer, implement changes, or apply distribution checks unless packaging itself is under review. Complete when the reviewer reports requirements, scope, evidence, and consumer-policy findings.

## Install-adapt branch

1. Classify the change and resolve capability tier separately from the actual available model.
2. Preview the complete write set:

   ```bash
   python3 scripts/install_harness.py --target /path/to/repo --platform codex --dry-run
   ```

3. Stop on collisions and merge manually. Use `--force` only with explicit replacement authority; backups remain target-confined and preflighted.
4. Let the leader delegate scoped changes to the implementer. Run consumer tests plus installed-adapter validation.
5. Assign a distinct reviewer. Require behavior, tests, security, state transitions, adapter conformance, and consumer-policy checks.
6. Apply rejected-review corrections through the implementer. Run final init after approval; only then may the leader record `done`.

## Package branch

Follow install-adapt and [distribution.md](references/distribution.md). Add distribution checks for synchronized core identity, wrapper behavior, packed artifacts, and release gates. Prepare only the explicitly requested artifacts; publishing and external mutation require separate authority.

## Invariants

- Keep the primary dispatcher limited to init and leader dispatch; keep the leader orchestration-only.
- Preserve branch-specific state graphs and actor identities in `.harness/task-status.json`; never clear completed or rejected evidence.
- Keep durable project memory separate from workflow state. Use `.harness/task-status.json` for execution state and use Memanto only through the project-context workflow.
- Checkpoint before each phase transition, delegation, compaction, and handoff.
- Record unavailable reviewer isolation in `degradedCapabilities` and label the result `review-pass`, not independent review.
- Keep commands, paths, permissions, language, and release rules in consumer policy.
- Keep installation idempotent, dry-runnable, and free of command execution from configuration.
