# Platform Adapters

## Shared contract

Every platform installs `.harness/contract.md`, `.harness/bin/workflow_state.py`, state, checkpoint, and configuration. Conformance checks assert equivalent branch routing, init gate, actor boundaries, checkpoints, review isolation, final-init gate, and collision behavior.

## Codex

- Use root `AGENTS.md` as the dispatcher.
- Define executable project custom agents in `.codex/agents/leader.toml`, `implementer.toml`, and `reviewer.toml`. Each file requires `name`, `description`, and `developer_instructions`; do not pin a model.
- Install `.agents/skills/custom-harness/SKILL.md` as a discovery pointer to `.harness/contract.md`. Do not install role contracts as `.agents/*.md`.
- Use native subagent coordination. Keep implementer and reviewer identities distinct and store only portable state under `.harness/`.

## Claude Code

- Use root `CLAUDE.md` as the dispatcher.
- Define native agents under `.claude/agents/` with frontmatter, bounded tools, and equivalent role contracts.
- Install `.claude/skills/custom-harness/SKILL.md` as a discovery pointer to `.harness/contract.md`.
- Permit reviewer Bash only for checks and guarded task-state/checkpoint writes, not implementation edits.

## Cursor

- Install one authoritative `.cursor/rules/custom-harness.mdc`; `.cursorrules` is legacy.
- When other adapters coexist, treat their root files as host-specific rather than competing Cursor policy.
- Prefer native isolated agents. Otherwise use separate chats or CLI invocations, record the isolation degradation, and call same-session validation a review pass.
- Do not claim independent review without a distinct actor identity.

## Capability negotiation

Detect native subagents, persistent identity, available model tiers, approval controls, and skill discovery at runtime. Record desired `capabilityTier` separately from `selectedModel`. Preserve every enforceable gate when a capability is missing and record the exact degradation.
