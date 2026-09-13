# Project Context Gate

The leader applies this gate after the entry gate and before analysis. It answers one question: does the agent hold enough durable project context to run the requested branch without guessing? Memanto is the preferred durable-memory provider when a compatible integration is available; repository evidence and the current conversation are the fallback.

Keep the gate proportional to the request: reuse established context for scoped follow-ups, and run a fresh sufficiency check for substantial, ambiguous, architectural, security-sensitive, or distribution work.

## 1. Check memory availability

Detect an existing Memanto interface (CLI, MCP server, native plugin, or Agent Skill) with read-only commands. Treat it as available only after a safe read succeeds.

When no interface exists, continue with the fallback. Install Memanto only when authority to install external dependencies already exists from the user, repository policy, or higher-priority policy; a request to use Custom Harness grants no such authority. Discovery, bootstrap, connection, and verification steps live in [memanto.md](memanto.md). A bootstrap that fails for any reason (permissions, network, runtime, credentials, verification) leaves Memanto unavailable; retry only on new evidence.

## 2. Recall

Scope recall to the current project using stable identifiers: repository name or origin, repository path, project name, harness component, target platform. Retrieve only memories relevant to the request, prioritising purpose, target platform, architecture, existing agent structure, technical decisions, constraints, conventions, testing expectations, security requirements, rejected approaches, known limitations, and definition of done.

Repository evidence and the current conversation remain authoritative over recalled memory. Answer from those three sources before asking the user anything.

## 3. Judge sufficiency

Evaluate only what materially affects the branch:

- `review`: review goal, scope, expected guarantees.
- `install-adapt`: target platform, intended harness behavior, integration constraints, consumer conventions, expected deliverables.
- `package`: install-adapt items plus distribution target, release constraints, artifact expectations.

Sufficient context lets the leader classify and delegate. Everything else is optional detail.

## 4. Grill Mode

Enter Grill Mode when a missing, conflicting, or ambiguous decision would materially change architecture, implementation strategy, compatibility, security, destructive behavior, distribution behavior, or acceptance criteria. Ask the minimum set of high-impact questions, grouped, usually two to five:

> I recovered the repository architecture and the Codex target from project context. Two decisions remain:
>
> 1. Should Custom Harness replace the existing agent workflow or coexist with it?
> 2. Must the installed harness work in repositories without Node.js available?

Wait for answers to blocking questions before delegation. When the user authorizes reasonable assumptions, continue under clearly stated assumptions and carry them as non-blocking uncertainty until confirmed. Ask a previously resolved question again only when current evidence conflicts with the stored answer or the user changes the decision.

## 5. Resolve conflicts

When memories contradict each other, compare them against current repository evidence and the explicit current request; the newer authoritative source wins. Surface the conflict through Grill Mode only when both memories are equally authoritative and the choice materially affects the task.

## 6. Persist

After resolution, and only when Memanto is available, store confirmed durable knowledge: architecture decisions, compatibility requirements, supported platforms, consumer constraints, explicit preferences, rejected approaches with rationale, project goals. Persist a fact once it is stated by the user, established by repository evidence, or confirmed in Grill Mode. Unconfirmed assumptions, command output, transient failures, stack traces, intermediate patches, speculative conclusions, and secrets stay out of memory.

Memory and workflow state stay separate: Memanto holds knowledge that outlives the task; `.harness/task-status.json` holds the current phase, actors, reviewer state, checkpoints, and evidence. Reconstruct workflow state only from the state file.

## 7. Continue

Checkpoint the context acquisition when applicable, select the branch, and continue with classification and delegation. Memory supplements repository evidence and never overrides higher-priority instructions, the current request, or the current repository state.
