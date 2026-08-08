# Consumer Configuration

## Precedence

Apply policy from highest to lowest priority:

1. Platform system, developer, and user instructions.
2. Repository instructions such as `AGENTS.md`, `CLAUDE.md`, or Cursor rules.
3. `.harness/config.toml`.
4. Safe harness defaults.

Reject a lower layer that attempts to broaden authority, expose secrets, skip review, or weaken a protected path.

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

Empty allowed paths mean “follow repository instructions and task scope,” not unrestricted write access. Commands are argument strings for human/agent execution; do not evaluate them from an untrusted configuration in the installer.

## Consumer discovery

Before proposing configuration:

- Inspect manifests, test folders, validation scripts, and existing agent instructions.
- Ask when commands, protected paths, or publication policy materially affect the result and cannot be inferred safely.
- Preserve existing rules through a manual merge when adapter files already exist.
- Keep secrets referenced only by environment-variable names; never copy values into state or checkpoints.
