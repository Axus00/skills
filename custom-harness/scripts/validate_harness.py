#!/usr/bin/env python3
"""Validate a Custom Harness skill source or installed consumer adapter."""

from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import re
import sys
import tomllib
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
WORKFLOW_SPEC = importlib.util.spec_from_file_location(
    "custom_harness_workflow_state", SCRIPT_DIR / "workflow_state.py"
)
assert WORKFLOW_SPEC and WORKFLOW_SPEC.loader
WORKFLOW = importlib.util.module_from_spec(WORKFLOW_SPEC)
sys.modules[WORKFLOW_SPEC.name] = WORKFLOW
WORKFLOW_SPEC.loader.exec_module(WORKFLOW)

SKILL_REQUIRED = (
    "SKILL.md",
    "agents/openai.yaml",
    "references/architecture.md",
    "references/configuration.md",
    "references/adapters.md",
    "references/distribution.md",
    "scripts/install_harness.py",
    "scripts/validate_harness.py",
    "scripts/workflow_state.py",
    "assets/templates/shared/.harness/config.toml",
    "assets/templates/shared/.harness/contract.md",
    "assets/templates/shared/.harness/task-status.json",
    "assets/templates/shared/.harness/context/task-context.toon",
)

COMMON_INSTALLED = (
    ".harness/config.toml",
    ".harness/contract.md",
    ".harness/bin/workflow_state.py",
    ".harness/task-status.json",
    ".harness/context/task-context.toon",
)

INSTALLED_REQUIRED = {
    "codex": (
        "AGENTS.md",
        ".codex/agents/leader.toml",
        ".codex/agents/implementer.toml",
        ".codex/agents/reviewer.toml",
        ".agents/skills/custom-harness/SKILL.md",
    ),
    "claude": (
        "CLAUDE.md",
        ".claude/agents/leader.md",
        ".claude/agents/implementer.md",
        ".claude/agents/reviewer.md",
        ".claude/skills/custom-harness/SKILL.md",
    ),
    "cursor": (".cursor/rules/custom-harness.mdc",),
}

FORBIDDEN_TEXT = {
    "state clearing instruction": r"(?:clear|empty|truncate|delete|remove).{0,80}task-status\.json",
    "ambiguous percentage checkpoint": r"(?:approximately|about|near|around)?\s*40\s*%",
    "duplicate Codex state authority": r"\.codex/(?:\.context/)?task-(?:status|context)",
}

ROLE_RULES = {
    "leader": (
        ("classification", r"classif"),
        ("capability tier", r"capabilitytier|capability tier"),
        ("selected model", r"selectedmodel|selected model"),
        ("delegation", r"delegat|route"),
        ("checkpoint", r"checkpoint"),
        ("owned transitions", r"record only.{0,80}analyzed.{0,40}delegated.{0,40}review-pending.{0,40}final-init-passed.{0,40}done"),
        ("state engine authority", r"workflow_state\.py.{0,80}never edit state"),
        ("no implementation", r"never (?:edit implementation|implement)"),
        ("no self approval", r"self-approve|approve your own"),
        ("final init before done", r"final.init.{0,100}(?:before|then|explicitly.{0,40}record).{0,60}done"),
    ),
    "implementer": (
        ("delegated identity", r"delegated.{0,80}(?:identity|scope)"),
        ("preserve changes", r"preserve"),
        ("tests", r"tests"),
        ("state evidence", r"implemented.{0,80}tested|tested.{0,80}implemented"),
        ("owned transitions", r"record only.{0,40}implemented.{0,40}tested"),
        ("state engine authority", r"workflow_state\.py.{0,80}never edit state"),
        ("cannot approve", r"never approve"),
        ("cannot close", r"(?:never|do not).{0,40}done"),
    ),
    "reviewer": (
        ("assigned identity", r"assign(?:ed|s)?.{0,80}(?:identity|review)"),
        ("no implementation edits", r"without changing implementation|no implementation edits"),
        ("conditional review", r"review.{0,160}install-adapt.{0,160}package"),
        ("approve or reject", r"review-approved.{0,80}review-rejected|review-rejected.{0,80}review-approved"),
        ("owned transitions", r"record only.{0,60}review-approved.{0,40}review-rejected|record only.{0,60}review-rejected.{0,40}review-approved"),
        ("state engine authority", r"workflow_state\.py.{0,80}never edit state"),
        ("cannot close", r"never.{0,60}done"),
    ),
}


def read_utf8(path: Path, label: str) -> tuple[str | None, list[str]]:
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        return None, [f"missing or empty: {label}"]
    try:
        return path.read_text(encoding="utf-8"), []
    except (UnicodeDecodeError, OSError) as exc:
        return None, [f"not readable UTF-8: {label}: {exc}"]


def normalized(content: str) -> str:
    return re.sub(r"\s+", " ", content.lower())


def rule_errors(label: str, content: str, rules: tuple[tuple[str, str], ...]) -> list[str]:
    value = normalized(content)
    return [
        f"{label} semantic invariant missing: {name}"
        for name, pattern in rules
        if not re.search(pattern, value)
    ]


def forbidden_errors(label: str, content: str) -> list[str]:
    value = normalized(content)
    return [
        f"{label} forbidden invariant: {name}"
        for name, pattern in FORBIDDEN_TEXT.items()
        if re.search(pattern, value)
    ]


def frontmatter(content: str, label: str) -> tuple[dict[str, str], list[str]]:
    lines = content.splitlines()
    if not lines or lines[0] != "---":
        return {}, [f"{label} must start with YAML frontmatter"]
    try:
        closing = lines.index("---", 1)
    except ValueError:
        return {}, [f"{label} frontmatter is not closed"]
    values: dict[str, str] = {}
    errors: list[str] = []
    for line in lines[1:closing]:
        if not line.strip():
            continue
        if ":" not in line:
            errors.append(f"{label} invalid frontmatter line: {line}")
            continue
        key, value = line.split(":", 1)
        values[key.strip()] = value.strip()
    return values, errors


def skill_pointer_errors(path: Path, platform: str) -> list[str]:
    content, errors = read_utf8(path, f"{platform} skill pointer")
    if content is None:
        return errors
    metadata, metadata_errors = frontmatter(content, f"{platform} skill pointer")
    errors.extend(metadata_errors)
    if metadata.get("name") != "custom-harness" or not metadata.get("description"):
        errors.append(f"{platform} skill pointer requires name and description")
    if set(metadata) != {"name", "description"}:
        errors.append(f"{platform} skill pointer frontmatter must contain only name and description")
    if ".harness/contract.md" not in content:
        errors.append(f"{platform} skill pointer must reference .harness/contract.md")
    if "single authoritative installed contract" not in content:
        errors.append(f"{platform} skill pointer must remain non-authoritative")
    return errors


def dispatcher_errors(path: Path, platform: str) -> list[str]:
    content, errors = read_utf8(path, f"{platform} dispatcher")
    if content is None:
        return errors
    errors.extend(forbidden_errors(f"{platform} dispatcher", content))
    rules = (
        ("portable contract", r"\.harness/contract\.md"),
        ("init before analysis", r"before analyz.{0,160}(?:run|execute).{0,80}init|before.{0,80}analyz.{0,80}init"),
        ("initialized evidence", r"record.{0,80}initialized"),
        ("leader dispatch", r"(?:spawn|invoke).{0,80}leader"),
        ("dispatcher no analysis", r"dispatcher.{0,100}no functional analysis|performs no functional analysis"),
        ("branch routing", r"review.{0,100}reviewer.{0,140}install-adapt.{0,100}implementer"),
        ("state engine authority", r"only.{0,80}workflow_state\.py.{0,40}mutat"),
        ("role transition ownership", r"dispatcher.{0,40}initialized.{0,100}leader.{0,120}final-init-passed.{0,40}done.{0,100}implementer.{0,60}implemented.{0,40}tested.{0,100}reviewer.{0,60}review-approved.{0,40}review-rejected"),
        ("final gate", r"reviewer approval.{0,100}final init"),
    )
    errors.extend(rule_errors(f"{platform} dispatcher", content, rules))
    value = normalized(content)
    init_position = value.find("before analyz")
    leader_position = max(value.find("spawn"), value.find("invoke"))
    if init_position < 0 or leader_position < 0 or init_position > leader_position:
        errors.append(f"{platform} dispatcher must place init before leader dispatch")
    return errors


def codex_agent_errors(path: Path, role: str) -> list[str]:
    content, errors = read_utf8(path, f"codex {role} agent")
    if content is None:
        return errors
    try:
        data = tomllib.loads(content)
    except (tomllib.TOMLDecodeError, UnicodeDecodeError) as exc:
        return [f"codex {role} agent invalid TOML: {exc}"]
    for field in ("name", "description", "developer_instructions"):
        if not isinstance(data.get(field), str) or not data[field].strip():
            errors.append(f"codex {role} agent missing string field: {field}")
    if data.get("name") != role:
        errors.append(f"codex {role} agent name must match its role")
    if "model" in data:
        errors.append(f"codex {role} agent must not pin a model")
    instructions = data.get("developer_instructions", "")
    errors.extend(rule_errors(f"codex {role} agent", instructions, ROLE_RULES[role]))
    errors.extend(forbidden_errors(f"codex {role} agent", instructions))
    return errors


def claude_agent_errors(path: Path, role: str) -> list[str]:
    content, errors = read_utf8(path, f"claude {role} agent")
    if content is None:
        return errors
    metadata, metadata_errors = frontmatter(content, f"claude {role} agent")
    errors.extend(metadata_errors)
    for field in ("name", "description", "tools"):
        if not metadata.get(field):
            errors.append(f"claude {role} agent missing frontmatter field: {field}")
    if metadata.get("name") != role:
        errors.append(f"claude {role} agent name must match its role")
    if role == "reviewer" and any(tool in metadata.get("tools", "") for tool in ("Edit", "Write")):
        errors.append("claude reviewer must not receive Edit or Write tools")
    errors.extend(rule_errors(f"claude {role} agent", content, ROLE_RULES[role]))
    errors.extend(forbidden_errors(f"claude {role} agent", content))
    return errors


def cursor_errors(path: Path) -> list[str]:
    content, errors = read_utf8(path, "cursor rule")
    if content is None:
        return errors
    metadata, metadata_errors = frontmatter(content, "cursor rule")
    errors.extend(metadata_errors)
    if metadata.get("alwaysApply") != "true" or not metadata.get("description"):
        errors.append("cursor rule requires description and alwaysApply: true")
    rules = (
        ("authoritative rule", r"authoritative cursor rule"),
        ("portable contract", r"\.harness/contract\.md"),
        ("init before analysis", r"before analysis.{0,120}(?:run|execute).{0,80}init"),
        ("separate execution", r"separate chats or cli invocations"),
        ("degraded review", r"review-isolation"),
        ("review pass label", r"review-pass"),
        ("independent warning", r"never an independent review"),
        ("review branch skips install", r"review.{0,80}reviewer.{0,80}without installation"),
        ("observable checkpoints", r"transition.{0,80}delegation.{0,80}compaction.{0,80}handoff"),
        ("state engine authority", r"only.{0,80}workflow_state\.py.{0,40}mutat"),
        ("role transition ownership", r"dispatcher.{0,40}initialized.{0,100}leader.{0,120}final-init-passed.{0,40}done.{0,100}implementer.{0,60}implemented.{0,40}tested.{0,100}reviewer.{0,60}review-approved.{0,40}review-rejected"),
        ("final gate", r"reviewer approval.{0,100}final init"),
    )
    errors.extend(rule_errors("cursor rule", content, rules))
    errors.extend(forbidden_errors("cursor rule", content))
    return errors


def contract_errors(path: Path) -> list[str]:
    content, errors = read_utf8(path, "portable contract")
    if content is None:
        return errors
    rules = (
        ("review graph", r"review.{0,160}initialized.{0,80}analyzed.{0,80}review-pending"),
        ("delivery graph", r"install-adapt.{0,180}delegated.{0,80}implemented.{0,80}tested"),
        ("final graph", r"review-approved.{0,80}final-init-passed.{0,80}done"),
        ("single state", r"only workflow state"),
        ("state engine authority", r"only.{0,80}workflow_state\.py.{0,80}mutat"),
        ("dispatcher transition ownership", r"dispatcher.{0,60}record only.{0,40}initialized"),
        ("leader transition ownership", r"leader.{0,100}record only.{0,100}analyzed.{0,40}delegated.{0,40}review-pending.{0,40}final-init-passed.{0,40}done"),
        ("implementer transition ownership", r"implementer.{0,120}record only.{0,40}implemented.{0,40}tested"),
        ("reviewer transition ownership", r"reviewer.{0,120}record only.{0,60}review-approved.{0,40}review-rejected"),
        ("separate model fields", r"capabilitytier.{0,80}selectedmodel"),
        ("actor evidence", r"actor role.{0,80}actor identity.{0,80}evidence"),
        ("checkpoint triggers", r"phase transition.{0,80}delegation.{0,80}compaction.{0,80}handoff"),
        ("review isolation", r"review-isolation"),
        ("review pass", r"review-pass"),
        ("conditional distribution", r"package.{0,100}distribution"),
        ("no config execution", r"never executes them automatically|never launch"),
    )
    errors.extend(rule_errors("portable contract", content, rules))
    errors.extend(forbidden_errors("portable contract", content))
    return errors


def task_status_errors(path: Path) -> list[str]:
    content, errors = read_utf8(path, "task-status.json")
    if content is None:
        return errors
    try:
        state = json.loads(content)
    except json.JSONDecodeError as exc:
        return [f"invalid task-status.json: {exc}"]
    return WORKFLOW.state_errors(state)


def checkpoint_errors(path: Path) -> list[str]:
    content, errors = read_utf8(path, "task-context.toon")
    if content is None:
        return errors
    required = (
        "objective",
        "trigger",
        "phase",
        "next_phase",
        "state_sequence",
        "actor_role",
        "actor_id",
        "decisions",
        "files",
        "tests",
        "blockers",
        "next_steps",
    )
    for field in required:
        if not re.search(rf"(?m)^{re.escape(field)}\s*:", content):
            errors.append(f"task-context.toon missing field: {field}")
    return errors


def engine_errors(path: Path) -> list[str]:
    content, errors = read_utf8(path, "workflow state engine")
    if content is None:
        return errors
    try:
        tree = ast.parse(content)
    except SyntaxError as exc:
        return [f"workflow state engine invalid Python: {exc}"]
    banned_imports = {"subprocess", "commands"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import) and any(alias.name in banned_imports for alias in node.names):
            errors.append("workflow state engine must not import command execution modules")
        if isinstance(node, ast.ImportFrom) and node.module in banned_imports:
            errors.append("workflow state engine must not import command execution modules")
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in {"system", "popen", "spawn", "run", "call", "check_call", "check_output"}:
                errors.append(f"workflow state engine must not execute commands: {node.func.attr}")
    source_rules = (
        ("branch graphs", r"transitions\s*="),
        ("actor roles", r"target_roles\s*="),
        ("review checks", r"required_review_checks\s*="),
        ("initial gate", r"initialinitpassed"),
        ("final gate", r"finalinitpassed"),
        ("selected model", r"selectedmodel"),
        ("checkpoint sequence", r"state_sequence"),
    )
    errors.extend(rule_errors("workflow state engine", content, source_rules))
    return list(dict.fromkeys(errors))


def platform_errors(base: Path, platform: str) -> list[str]:
    if platform == "codex":
        errors = dispatcher_errors(base / "AGENTS.md", platform)
        for role in ("leader", "implementer", "reviewer"):
            errors.extend(codex_agent_errors(base / f".codex/agents/{role}.toml", role))
        errors.extend(skill_pointer_errors(base / ".agents/skills/custom-harness/SKILL.md", platform))
        for obsolete in (".agents/leader.md", ".agents/implementer.md", ".agents/reviewer.md"):
            if (base / obsolete).exists() or (base / obsolete).is_symlink():
                errors.append(f"codex obsolete role contract must not be installed: {obsolete}")
        return errors
    if platform == "claude":
        errors = dispatcher_errors(base / "CLAUDE.md", platform)
        for role in ("leader", "implementer", "reviewer"):
            errors.extend(claude_agent_errors(base / f".claude/agents/{role}.md", role))
        errors.extend(skill_pointer_errors(base / ".claude/skills/custom-harness/SKILL.md", platform))
        return errors
    return cursor_errors(base / ".cursor/rules/custom-harness.mdc")


def skill_router_errors(path: Path) -> list[str]:
    content, errors = read_utf8(path, "SKILL.md")
    if content is None:
        return errors
    metadata, metadata_errors = frontmatter(content, "SKILL.md")
    errors.extend(metadata_errors)
    if set(metadata) != {"name", "description"}:
        errors.append("SKILL.md frontmatter must contain only name and description")
    if metadata.get("name") != "custom-harness" or not metadata.get("description"):
        errors.append("SKILL.md requires custom-harness name and description")
    for heading in ("## Common gate", "## Review branch", "## Install-adapt branch", "## Package branch"):
        if heading not in content:
            errors.append(f"SKILL.md missing router heading: {heading}")
    review_match = re.search(r"## Review branch(.*?)(?=\n## |\Z)", content, re.DOTALL)
    if not review_match or not re.search(
        r"Do not preview installation.*invoke the installer.*implement changes.*distribution checks",
        review_match.group(1),
        re.DOTALL,
    ):
        errors.append("SKILL.md review branch must prohibit install, implementation, and unconditional distribution")
    if "[distribution.md](references/distribution.md) only for the `package` branch" not in content:
        errors.append("SKILL.md must disclose distribution reference only for package")
    if re.search(r"\bTODO\b", content):
        errors.append("SKILL.md contains a TODO placeholder")
    errors.extend(forbidden_errors("SKILL.md", content))
    return errors


def validate_skill(root: Path) -> list[str]:
    errors: list[str] = []
    for relative in SKILL_REQUIRED:
        path = root / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing or empty: {relative}")
    errors.extend(skill_router_errors(root / "SKILL.md"))
    errors.extend(engine_errors(root / "scripts/workflow_state.py"))

    shared = root / "assets/templates/shared"
    errors.extend(contract_errors(shared / ".harness/contract.md"))
    errors.extend(task_status_errors(shared / ".harness/task-status.json"))
    errors.extend(checkpoint_errors(shared / ".harness/context/task-context.toon"))

    for platform, required in INSTALLED_REQUIRED.items():
        base = root / "assets/templates" / platform
        for relative in required:
            path = base / relative
            if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
                errors.append(f"{platform} template missing: {relative}")
        errors.extend(platform_errors(base, platform))
    return errors


def validate_target(target: Path, platforms: list[str]) -> list[str]:
    errors: list[str] = []
    required = (*COMMON_INSTALLED, *(item for platform in platforms for item in INSTALLED_REQUIRED[platform]))
    for relative in required:
        path = target / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing or empty: {relative}")
    errors.extend(contract_errors(target / ".harness/contract.md"))
    errors.extend(engine_errors(target / ".harness/bin/workflow_state.py"))
    errors.extend(task_status_errors(target / ".harness/task-status.json"))
    errors.extend(checkpoint_errors(target / ".harness/context/task-context.toon"))
    for platform in platforms:
        errors.extend(platform_errors(target, platform))
    return errors


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--skill-root", type=Path)
    group.add_argument("--target", type=Path)
    parser.add_argument("--platform", action="append", choices=tuple(INSTALLED_REQUIRED), dest="platforms")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    errors = (
        validate_skill(args.skill_root.resolve())
        if args.skill_root
        else validate_target(args.target.resolve(), args.platforms or ["codex"])
    )
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    print("custom-harness: validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
