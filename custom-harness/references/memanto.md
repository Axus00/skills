# Memanto Integration

Read this only when the project context gate needs to discover, bootstrap, connect, or verify Memanto. The gate itself, recall, persistence, and conflict rules live in [project-context.md](project-context.md).

## 1. Official sources

Use exactly these sources and the procedures they document:

- Project and CLI: `moorcheh-ai/memanto` (PyPI package `memanto`).
- Agent Skills integration: `moorcheh-ai/memanto-agent-skills`.

Every command below comes from those sources. When the documented procedure and this file disagree, follow the documented procedure and report the drift.

## 2. Discover

Check, in order and with read-only operations: an already configured Memanto integration for the current agent, the `memanto` CLI, an installed Memanto Agent Skill or native plugin, an explicitly configured Memanto MCP integration. A CLI counts as present once `memanto --help` or another documented non-mutating status operation exits `0`. Keep a working setup as it is.

## 3. Authority

Installing Memanto mutates the execution environment, so it needs authority that already exists: an explicit user instruction, repository policy, or higher-priority execution policy. Without it, return to the gate with Memanto unavailable. When the requested operation cannot proceed without durable memory, report the missing capability and request the minimum authority needed.

## 4. Preflight

Before an authorized installation, identify the exact documented installation path, the files and locations it may modify, the runtimes and services it needs, and the working-tree changes already present. Choose the least invasive supported scope, preferring repository-local or user-local installation over system-wide, and keep repository secrets unread.

## 5. Bootstrap

The Memanto CLI is a Python package (Python 3.10 or newer):

```bash
pip install memanto
memanto --help
```

Respect repository policy on virtual environments and isolated dependency management. A non-zero exit from verification means the environment is not ready until diagnosed.

Skills-only installation is available when full CLI integration is unnecessary:

```bash
npx skills add moorcheh-ai/memanto-agent-skills
```

Skills alone provide instructions, not a memory runtime; a usable backend, project scope, and credentials are still required.

## 6. Connect

Connect the CLI to the current agent with the documented integration:

| Platform    | Integration                                                |
| ----------- | ---------------------------------------------------------- |
| Codex       | `memanto connect codex`                                    |
| Claude Code | native Memanto plugin, or `memanto connect claude-code`    |
| Cursor      | native Memanto plugin, or `memanto connect cursor`         |

`connect` may write agent instructions, skills, and hooks. When those files are repository-controlled, inspect the write scope first and preserve existing consumer instructions and rules.

## 7. Configure

A successful installation is not yet a usable memory. Depending on deployment, Memanto needs a Moorcheh account and `MOORCHEH_API_KEY`, or a local or on-premises provider configuration, plus an active project or agent scope. Refer to credentials by environment-variable name only. Credentials stay out of `.harness/task-status.json`, checkpoints, memories, review evidence, and generated documentation. Missing credentials leave Memanto unavailable.

## 8. Scope

Establish the project identity before any recall or persistence, using the stable identifiers from the gate. When Memanto supports project or agent scoping, use a dedicated scope for the current project, creating one through the official workflow when authority permits. Prefer that narrow scope over global memory.

## 9. Verify

Memanto is available once all layers succeed: the interface exists, it responds, configuration is valid, the project scope is active, and a safe read operation returns. Installation success alone proves nothing about memory.

## 10. Return

Return to the gate with one of three outcomes: available (durable memory enabled), unavailable with a safe fallback (continue on repository evidence and conversation, note the fallback in the next checkpoint), or unavailable and required (report the blocking reason and the minimum authority or configuration needed). The gate decides whether Grill Mode follows.
