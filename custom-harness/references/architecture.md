# Architecture

## Components

The language-neutral core contains a policy resolver, classifier, guarded workflow engine, portable state store, validation gates, platform renderers, and optional distribution wrappers. Adapters vary syntax and invocation while preserving state, authority, and review semantics.

The installed `.harness/contract.md` is the single behavioral contract. Codex and Claude Skills are discovery pointers; dispatchers and role definitions point to the contract instead of restating a second authoritative workflow.

## Branch state graphs

```text
review:
uninitialized -> initialized -> analyzed -> review-pending
review-pending -> review-rejected -> analyzed
review-pending -> review-approved -> final-init-passed -> done

install-adapt | package:
uninitialized -> initialized -> analyzed -> delegated -> implemented -> tested
tested -> review-pending -> review-rejected -> delegated
review-pending -> review-approved -> final-init-passed -> done
```

The initial transition requires an explicitly executed init command with exit code `0`. Every later transition requires a fresh checkpoint tied to the current evidence sequence. The final-init transition requires reviewer approval; `done` requires final init.

## State contract

`.harness/task-status.json` is the only workflow state. Schema version 2 records task, branch, classification, status, phase, ordered evidence, dependencies, `capabilityTier`, `selectedModel`, degraded capabilities, actor identities, reviewer result, and initial/final validation. Never mirror authoritative state under a platform-local path.

Each evidence event records sequence, timestamp, branch, prior phase, next phase, actor role, actor identity, and summary. Init evidence also records command and exit code. Preserve approval, rejection, and correction history.

`.harness/context/task-context.toon` records objective, trigger, current/next phase, state sequence, actor, decisions, files, tests/checks, blockers, and next steps. Observable triggers are before phase change, delegation, compaction, and handoff.

## Roles and isolation

The dispatcher only runs the initial gate and invokes the leader. The leader classifies, coordinates, and closes; the implementer changes delegated scope; the reviewer inspects without implementation edits. Reviewer identity must differ from delivery identities. A platform lacking isolation records `review-isolation:<reason>` and calls the result a `review-pass`.

## Classification

| Class | Signals | Capability profile |
| --- | --- | --- |
| `small` | Localized, low risk, few files, no external state | Fast suitable tier |
| `medium` | Multiple files, one integration, moderate ambiguity or risk | Balanced tier |
| `large` | Cross-cutting architecture, persistence, security, distribution, or high blast radius | Strongest suitable tier |

Record evidence for the label. `capabilityTier` expresses the desired profile; `selectedModel` records the model actually available at runtime. Adapters never pin a vendor model.

## Safety and idempotency

The installer preflights the complete write set, backups, and ancestors. It rejects symlinks, hard-linked destinations, non-directory ancestors, unwritable parents, and path overlap. Identical files are no-ops; divergent files are collisions. Authorized replacement creates target-confined backups. Neither installer nor state engine executes configuration commands.
