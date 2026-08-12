# CLAUDE.md

## Bootstrap dispatcher

For requests that install, adapt, review, package, or implement `custom-harness`, run `init.sh` or `init.ps1` before functional analysis. Diagnose failures and retry. After the successful gate, read `custom-harness/SKILL.md` in full and invoke the leader; the dispatcher does not classify or implement.

The Skill is the router and authoritative navigation guide. Always read `custom-harness/references/architecture.md` and `configuration.md`; read `adapters.md` only for requested platforms and `distribution.md` only for package/distribution work. Apply higher-priority and consumer policy first.

## Orchestration and continuity

The leader selects `review`, `install-adapt`, or `package`, then classifies the task as `small`, `medium`, or `large` from scope, risk, integrations, persistence, and file count. Record the desired `capabilityTier` separately from the runtime `selectedModel`; use only models the platform offers.

Use `.harness/task-status.json` as the single portable state. Only `.harness/bin/workflow_state.py` may mutate the state or checkpoint; roles never edit either file directly. The dispatcher records only `initialized`; the leader records only `analyzed`, `delegated`, `review-pending`, `final-init-passed`, and `done`; the implementer records only `implemented` and `tested`; the reviewer records only `review-approved` and `review-rejected`. Each role records its own checkpoints through the same engine. Preserve rejection and correction evidence. The leader retains exclusive ownership of `final-init-passed` and `done`, after reviewer approval and successful final init.

## Purpose

This repository develops and validates a reusable harness for coordinating agents in consumer repositories. Keep the core agnostic to language, framework, and domain; put specific rules in consumer configuration or instructions.

## Agent rules

- Required delivery flow: `init → analysis → implementation → tests → reviewer → corrections if applicable → final init`. The read-only review branch skips implementation and delivery tests.
- Every new implementation includes tests following repository conventions.
- Do not modify project documentation; the owner maintains it.
- Do not change behavior outside the requested scope.
- Do not modify configuration or infrastructure without explicit owner authorization.
- Do not read, display, copy, or modify secrets, tokens, credentials, or `.env` files.
- Permitted modifications are `AGENTS.md`, `CLAUDE.md`, local agents in `.agents/`, `custom-harness/`, and validation scripts. Only `.harness/bin/workflow_state.py` mutates state and checkpoint files, under the role-owned transitions above.
- Use Spanish for business rules and functional messages; use English for names, comments, and code.
- Follow Conventional Branch and Conventional Commits.
- Do not create commits or publish changes; leave everything prepared for review.
- Preserve pre-existing user changes and use `apply_patch` for manual edits.
- Resolve policy in this order: system/user instructions, consumer instructions, optional harness configuration, safe defaults.

## Local roles

- `.agents/leader.md`: coordinates and manages subagents without implementing.
- `.agents/implementer.md`: makes scoped changes and runs tests.
- `.agents/reviewer.md`: validates behavior, tests, best practices, and conventions without implementation edits.

For `review`, the leader delegates directly to the reviewer. For delivery branches it delegates to the implementer and then reviewer. Rejected work returns to the implementer.

## Project map

- `custom-harness/`: self-contained Skill, references, templates, scripts, and tests.
- `.agents/`: local development contracts and repository Skills.
- `.harness/`: portable workflow state and checkpoint when the installed harness is exercised.
- `init.sh` and `init.ps1`: reproducible repository validation.
- `docs/` and `README.md`: owner-maintained documentation; do not modify.

## Final validation

A change is ready only when tests and validations pass, structural conflicts are absent, Markdown is valid, adapters preserve core invariants, and the reviewer approves the branch-specific checks.
