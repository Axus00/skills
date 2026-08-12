# Custom Harness Contract

## Entry gate

The primary dispatcher performs only policy loading and command selection before validation. Select an authorized repository-local init command, run it explicitly, diagnose failures, and continue only after exit code `0`. Treat `.harness/config.toml` command arrays as data to review; the harness never executes them automatically.

Record the successful command with `.harness/bin/workflow_state.py transition --to initialized`. Then dispatch the leader. The dispatcher does not classify, analyze, implement, or review the request.

## Branch router

- `review`: `initialized -> analyzed -> review-pending -> review-approved|review-rejected`; a rejection returns to `analyzed`. This branch inspects and reports without installing or implementing.
- `install-adapt`: `initialized -> analyzed -> delegated -> implemented -> tested -> review-pending -> review-approved|review-rejected`; a rejection returns to `delegated`.
- `package`: uses the install-adapt graph and adds distribution verification.
- Every approved branch continues `review-approved -> final-init-passed -> done`.

The leader selects the branch after the entry gate. It records classification evidence, `capabilityTier`, and the distinct runtime `selectedModel`. It delegates install/adapt/package work to the implementer and sends review work directly to the reviewer.

## State engine

Use `.harness/task-status.json` as the only workflow state. Only `.harness/bin/workflow_state.py` may mutate that state or its checkpoint; roles never edit either file directly. Invoke the engine through:

```text
<python> .harness/bin/workflow_state.py transition ...
<python> .harness/bin/workflow_state.py checkpoint ...
<python> .harness/bin/workflow_state.py check
```

Run `--help` for exact arguments. Every transition records its prior phase, next phase, actor role, actor identity, evidence, and timestamp. Use a stable thread, chat, or session identifier for `--actor-id`. The engine rejects analysis without a successful initial init, undelegated implementers, invalid phase order, incomplete reviewer checks, final init before approval, and `done` before final init. Preserve the status file and all completed or rejected evidence.

Checkpoint before each phase transition, delegation, compaction, and handoff. Tie it to the current evidence sequence. Use trigger `before-delegation` when entering `delegated` and `before-phase-change` for other transitions. Include objective, decisions, files, tests/checks, blockers, and next steps.

## Role boundaries

- Dispatcher: run the entry gate, record only `initialized`, and invoke the leader.
- Leader: analyze, classify, select available capability/model, coordinate, and record only `analyzed`, `delegated`, `review-pending`, `final-init-passed`, and `done`. It never implements, corrects, or self-approves. It retains exclusive ownership of final init and `done`.
- Implementer: change only delegated scope, preserve user work, add and run relevant tests, and record only `implemented` and `tested`.
- Reviewer: inspect without changing implementation files, record only `review-approved` or `review-rejected`, and never set `done`.

Each role records only the checkpoints for its own transitions through the engine.

Assign a reviewer identity different from leader and implementer identities. If the platform cannot provide isolated identities, pass an explicit `--degraded-review` reason when requesting review; the engine records `review-isolation:<reason>`, labels the result `review-pass`, and does not call it independent.

## Review gates

- `review`: requirements, scope, evidence, and consumer policy.
- `install-adapt`: review checks plus behavior, tests, security, state transitions, and adapter conformance.
- `package`: install-adapt checks plus distribution.

Only the assigned reviewer records `review-approved` or `review-rejected`. After approval, the leader explicitly runs the authorized final init, records `final-init-passed`, checkpoints, and records `done`.

## Safety

Apply policy in this order: platform/system/user instructions, repository instructions, `.harness/config.toml`, safe defaults. Preserve existing changes, protected paths, and secrets. Installation remains preflighted, idempotent, and collision-safe. Commit, publish, replacement, and external mutation require explicit authority.
