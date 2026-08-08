# Architecture

## Components

The harness is a hexagonal system whose core is independent from any agent product:

1. **Policy resolver** combines higher-priority instructions, consumer policy, and safe defaults.
2. **Classifier** assigns `small`, `medium`, or `large` from scope, risk, integrations, persistence, and file count.
3. **Workflow engine** enforces state transitions and role separation.
4. **State store** persists task status and a context checkpoint inside the repository.
5. **Validation gate** runs consumer-defined checks and requires reviewer approval.
6. **Platform adapters** render equivalent instructions into Codex, Claude, or Cursor conventions.
7. **Distribution wrappers** expose the same versioned core through JavaScript and .NET ecosystems.

Adapters may change syntax and invocation but must not change core semantics.

## State machine

```text
uninitialized
  -> in-progress/classified
  -> delegated
  -> implemented
  -> tested
  -> review-rejected -> delegated
  -> review-approved
  -> final-init-passed
  -> done
```

Only the leader writes `done`. A failed check, missing review, or unresolved collision keeps the task `in-progress`.

## Classification

| Class | Typical signals | Execution profile |
| --- | --- | --- |
| `small` | Localized change, low risk, few files, no external state | Fast available model; one implementer pass and review |
| `medium` | Multiple files, one integration, moderate ambiguity or risk | Balanced reasoning; explicit test plan and review |
| `large` | Cross-cutting architecture, persistence, security, distribution, or high blast radius | Strongest suitable model; staged delegation and checkpointing |

Record the evidence, not only the label. Model selection is a capability tier resolved at runtime, never a hard-coded vendor model name.

## State contracts

Use `.harness/task-status.json` as the portable state and `.harness/context/task-context.toon` as the checkpoint. Platform adapters may use an established product-local path when required, but must retain the same fields and ownership.

Task status contains `schemaVersion`, task identity, classification, state, evidence, dependencies, selected capability tier, degraded capabilities, reviewer result, and validation result. An `in-progress` record may retain null task-dependent values from the initial template. A `done` record requires a non-empty task, classification, capability tier, `review.approved=true`, and `validation.finalInitPassed=true`. The checkpoint contains objective, decisions, touched files, executed tests/checks, blockers, and next steps. Store no prompts, credentials, tokens, or sensitive payloads.

## Safety and idempotency

Preflight the complete write set, including backup destinations and every ancestor, before mutation. Reject symlinks, existing destinations with multiple hard links, non-directory ancestors, unwritable parents, and overlap between planned files or backups. Identical single-link files are no-ops. Existing divergent files are collisions. Default behavior aborts without partial writes; authorized replacement creates only preflighted, target-confined backups before changing consumer files. Consumer build and test commands remain opt-in configuration and never execute merely because templates were installed.
