# CLAUDE.md

## Entry point for skill consumers

When a request involves installing, adapting, reviewing, packaging, or implementing `custom-harness`, read `custom-harness/SKILL.md` in full after the initial validation and before analysis. That file is the authoritative navigation guide and defines progressive reference disclosure:

- always read `custom-harness/references/architecture.md` and `custom-harness/references/configuration.md`;
- read `custom-harness/references/adapters.md` only for the requested platforms (Codex, Claude Code, or Cursor);
- read `custom-harness/references/distribution.md` only for packaging, distribution, or publishing.

Do not duplicate or contradict the skill contract in these instructions. Apply higher-priority instructions and consumer-repository policy first; use the preceding references only when the request scope requires them.

## Orchestration and continuity

The leader classifies each request as `small`, `medium`, or `large` according to scope, risk, integrations, persistence, and file count. It must select the appropriate available model, record the decision in `.codex/task-status.json`, and delegate to the corresponding subagent. It must not pin a model the platform does not offer.

When approximately 40% of operational context remains, it must update `.codex/.context/task-context.toon` with the objective, decisions, files, tests, blockers, and next steps. If the platform allows opening another chat, continue by reading that checkpoint; otherwise, read it in the current chat.

Tasks use the `in-progress` and `done` states in `.codex/task-status.json`. Only the leader may assign `done`, after reviewer approval and successful final validation. This file is the authorized exception to the general rule against modifying JSON.

## Purpose

This repository develops and validates a reusable harness for coordinating agents in consumer repositories. The core must remain agnostic to language, framework, and domain; specific rules belong in consumer configuration or instructions.

## Agent rules

- Before any analysis or implementation, run `init.sh` or `init.ps1`.
- If it fails, diagnose and fix it, then run the script again.
- Required flow: `init → analysis → implementation → tests → reviewer → corrections if applicable → final init`.
- Every new implementation must include tests following the repository's existing conventions.
- Do not modify project documentation; the owner maintains it.
- Do not modify existing behavior beyond the requested change.
- Do not modify configuration or infrastructure without explicit authorization from the owner.
- Do not read, display, copy, or modify secrets, tokens, credentials, or `.env` files.
- In this repository, permitted modifications are `AGENTS.md`, `CLAUDE.md`, local agents in `.agents/`, `custom-harness/`, and validation scripts. Only the leader manages the state and checkpoint files.
- Use Spanish for business rules and functional messages; use English for names, comments, and code.
- Follow Conventional Branch and Conventional Commits.
- Do not create commits or publish changes; leave everything prepared for review.
- Preserve pre-existing user changes and use `apply_patch` for manual edits.
- Resolve policy in this order of precedence: system/user instructions, consumer-repository instructions, optional harness configuration, and safe defaults.

## Roles

- `.agents/leader.md`: coordinates and manages subagents; it does not implement directly.
- `.agents/implementer.md`: makes scoped changes and runs tests.
- `.agents/reviewer.md`: validates behavior, tests, best practices, and conventions.

The leader requests review after implementation. If it fails, it returns the work to the implementer and requests another review.

## Project map

- `custom-harness/`: self-contained skill, references, templates, scripts, and tests.
- `.agents/`: local contracts for the leader, implementer, and reviewer.
- `.codex/`: the leader's operational state and checkpoint.
- `init.sh` and `init.ps1`: reproducible repository validation.
- `docs/` and `README.md`: documentation maintained by the owner; do not modify.

## Final validation

A change is ready only when tests and validations pass, there are no structural conflicts, Markdown has valid structure, adapters preserve core invariants, and `reviewer.md` approves it.
