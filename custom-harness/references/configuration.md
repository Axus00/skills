# Consumer Configuration

## Precedence

Apply policy from highest to lowest priority:

1. Platform system, developer, and user instructions.
2. Repository instructions such as `AGENTS.md`, `CLAUDE.md`, or Cursor rules.
3. `.harness/config.toml`.
4. Safe harness defaults.

Reject a lower layer that broadens authority, exposes secrets, skips review, or weakens a protected path.

## Schema

Keep consumer choices in `.harness/config.toml`:

```toml
schema_version = 1
project_name = "example"
default_platforms = ["codex"]

[classification]
small_max_files = 3
medium_max_files = 10
large_risk_labels = ["security", "persistence", "release", "migration"]

[commands]
init = ["./init.sh"]
test = []
final = ["./init.sh"]

[policy]
allowed_write_paths = []
protected_paths = [".env*", "**/*.key", "**/*secret*"]
documentation_paths = ["README.md", "docs/**"]
allow_commits = false
allow_publish = false

[language]
functional_messages = "consumer-defined"
code = "consumer-defined"
```

Empty allowed paths mean “follow repository instructions and task scope,” not unrestricted access. Command arrays are data for an agent or human to vet against higher-priority policy and execute explicitly. The installer and workflow engine never launch them.

The workflow state stores desired `capabilityTier` separately from runtime `selectedModel`; configuration does not hard-code an unavailable vendor model.

## Consumer discovery

- Inspect manifests, test folders, validation scripts, and existing agent instructions.
- Ask when commands, protected paths, or publication policy materially affect the result and cannot be inferred safely.
- Preserve existing rules through manual merge when adapter files collide.
- Refer to secrets only by environment-variable name; never copy values into state or checkpoints.
