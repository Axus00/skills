# Platform Adapters

## Shared contract

Generate platform files from one versioned core. Conformance checks must assert the same classification levels, role boundaries, workflow gates, state ownership, collision policy, and checkpoint fields across adapters.

## Codex

- Use root `AGENTS.md` for repository instructions.
- Keep role contracts in `.agents/leader.md`, `.agents/implementer.md`, and `.agents/reviewer.md`, referenced from `AGENTS.md`.
- Use available subagent/thread coordination tools. The leader delegates and waits; it never edits implementation files.
- Store portable state under `.harness/`; if a host requires `.codex/`, map the same schema without duplicating authority.

## Claude Code

- Use root `CLAUDE.md` for repository instructions.
- Install reusable skills in `.claude/skills/<skill-name>/SKILL.md` for project scope or `~/.claude/skills` for user scope.
- Render native subagent definitions under `.claude/agents/` with explicit leader, implementer, and reviewer responsibilities.
- Keep the leader agent tool set read/coordinate oriented; grant write tools only to the implementer when policy allows.

## Cursor

- Prefer Agent Skills and project rules in `.cursor/rules/*.mdc`; `.cursorrules` is legacy.
- Cursor CLI also reads root `AGENTS.md` and `CLAUDE.md`, but generate one authoritative Cursor rule to avoid contradictory duplicates.
- If the active Cursor environment cannot create independently isolated subagents, run role passes in separate chats/CLI invocations and mark review as degraded. Never claim independent review from a single uninterrupted role-playing pass.
- Keep rule metadata focused and version controlled; do not place credentials or permission grants in generated prose.

## Capability negotiation

At runtime detect: native subagents, model tiers, persistent thread support, approval controls, and skill discovery paths. Select the strongest supported behavior. When a capability is absent, record the degradation in task status and preserve all enforceable gates.
