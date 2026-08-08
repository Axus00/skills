#!/usr/bin/env python3
"""Validate a Custom Harness skill source or installed consumer adapter."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


SKILL_REQUIRED = (
    "SKILL.md",
    "agents/openai.yaml",
    "references/architecture.md",
    "references/configuration.md",
    "references/adapters.md",
    "references/distribution.md",
    "scripts/install_harness.py",
    "scripts/validate_harness.py",
    "assets/templates/shared/.harness/config.toml",
    "assets/templates/shared/.harness/task-status.json",
    "assets/templates/shared/.harness/context/task-context.toon",
)

INSTALLED_REQUIRED = {
    "codex": ("AGENTS.md", ".agents/leader.md", ".agents/implementer.md", ".agents/reviewer.md"),
    "claude": (
        "CLAUDE.md",
        ".claude/agents/leader.md",
        ".claude/agents/implementer.md",
        ".claude/agents/reviewer.md",
    ),
    "cursor": (".cursor/rules/custom-harness.mdc",),
}

MAIN_RULES = (
    ("classification levels", r"\bsmall\b.*\bmedium\b.*\blarge\b"),
    (
        "complete workflow cycle",
        r"\binit\b.*\banalysis\b.*\bimplementation\b.*\btests\b.*\breviewer\b.*\bcorrections\b.*final init",
    ),
    ("task state", r"\.harness/task-status\.json"),
    ("context checkpoint", r"\.harness/context/task-context\.toon"),
    (
        "done gate",
        r"done.{0,180}(?:reviewer approval|independent approval).{0,100}(?:final validation|final init)",
    ),
)

ROLE_RULES = {
    "leader": (
        ("leader identity", r"\bleader\b"),
        ("classification duty", r"\bclassif"),
        ("record duty", r"\brecord"),
        ("delegation duty", r"\bdelegat"),
        ("coordination duty", r"\bcoordinat"),
        ("does not implement", r"(?:without implementing|never implement|never edit implementation)"),
        ("does not self-approve", r"self-approve|self approve"),
        ("review dependency", r"\breviewer\b"),
        ("final validation dependency", r"final validation"),
    ),
    "implementer": (
        ("implementer identity", r"\bimplementer\b"),
        ("delegated scope", r"delegated scope"),
        ("preserve changes", r"\bpreserve"),
        ("tests duty", r"\btests\b"),
        ("report duty", r"\breport"),
        ("cannot set done", r"never (?:mark|set).{0,30}\bdone\b"),
        ("cannot self-approve", r"approve your own work"),
    ),
    "reviewer": (
        ("reviewer identity", r"\breviewer\b"),
        ("independent no-edit review", r"(?:without editing|review without editing)"),
        ("validation duty", r"\bvalidat|\bverif"),
        ("approve or reject", r"\breject.{0,100}\bapprove|\bapprove.{0,100}\breject"),
        ("cannot set done", r"never (?:mark|set).{0,30}\bdone\b"),
    ),
}

ADAPTER_LAYOUT = {
    "codex": {
        "main": "AGENTS.md",
        "roles": {
            "leader": ".agents/leader.md",
            "implementer": ".agents/implementer.md",
            "reviewer": ".agents/reviewer.md",
        },
    },
    "claude": {
        "main": "CLAUDE.md",
        "roles": {
            "leader": ".claude/agents/leader.md",
            "implementer": ".claude/agents/implementer.md",
            "reviewer": ".claude/agents/reviewer.md",
        },
    },
}

CURSOR_RULES = (
    *MAIN_RULES,
    ("leader role", r"\bleader\b"),
    ("leader does not implement", r"does not implement"),
    ("implementer role", r"\bimplementer\b"),
    ("reviewer role", r"\breviewer\b"),
    ("Cursor unavailable capability", r"unavailable"),
    ("Cursor separate review execution", r"separate agent chats or cli invocations"),
    ("Cursor degraded capability", r"degraded capability"),
    ("Cursor independent review warning", r"never claim independent review"),
)


def file_semantic_errors(base: Path, platform: str, relative: str, rules) -> list[str]:
    errors: list[str] = []
    path = base / relative
    if not path.is_file() or path.is_symlink():
        return errors
    try:
        normalized = re.sub(r"\s+", " ", path.read_text(encoding="utf-8").lower())
    except (UnicodeDecodeError, OSError) as exc:
        return [f"{platform} adapter is not readable UTF-8: {relative}: {exc}"]
    for label, pattern in rules:
        if not re.search(pattern, normalized):
            errors.append(f"{platform} {relative} semantic invariant missing: {label}")
    return errors


def semantic_errors(base: Path, platform: str) -> list[str]:
    if platform == "cursor":
        return file_semantic_errors(
            base, platform, ".cursor/rules/custom-harness.mdc", CURSOR_RULES
        )
    layout = ADAPTER_LAYOUT[platform]
    errors = file_semantic_errors(base, platform, layout["main"], MAIN_RULES)
    for role, relative in layout["roles"].items():
        errors.extend(file_semantic_errors(base, platform, relative, ROLE_RULES[role]))
    return errors


STATUS_FIELDS = {
    "schemaVersion",
    "task",
    "classification",
    "status",
    "evidence",
    "dependencies",
    "capabilityTier",
    "degradedCapabilities",
    "review",
    "validation",
}


def task_status_errors(path: Path) -> list[str]:
    errors: list[str] = []
    if not path.is_file() or path.is_symlink():
        return errors
    try:
        status = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        return [f"invalid task-status.json: {exc}"]
    if not isinstance(status, dict):
        return ["task-status.json must be an object"]
    for field in sorted(STATUS_FIELDS - set(status)):
        errors.append(f"task-status.json missing field: {field}")
    if status.get("schemaVersion") != 1:
        errors.append("task-status.json schemaVersion must be 1")
    if status.get("task") is not None and not isinstance(status.get("task"), str):
        errors.append("task-status.json task must be a string or null")
    if status.get("classification") not in {None, "small", "medium", "large"}:
        errors.append("task-status.json classification must be small, medium, large, or null")
    if status.get("status") not in {"in-progress", "done"}:
        errors.append("task-status.json status must be in-progress or done")
    for field in ("evidence", "dependencies", "degradedCapabilities"):
        if not isinstance(status.get(field), list):
            errors.append(f"task-status.json {field} must be an array")
    if status.get("capabilityTier") is not None and not isinstance(
        status.get("capabilityTier"), str
    ):
        errors.append("task-status.json capabilityTier must be a string or null")
    for field in ("review", "validation"):
        if status.get(field) is not None and not isinstance(status.get(field), dict):
            errors.append(f"task-status.json {field} must be an object or null")
    if status.get("status") == "done":
        review = status.get("review")
        validation = status.get("validation")
        if not isinstance(status.get("task"), str) or not status.get("task", "").strip():
            errors.append("done task requires a non-empty task")
        if status.get("classification") not in {"small", "medium", "large"}:
            errors.append("done task requires a classification")
        if not isinstance(status.get("capabilityTier"), str) or not status.get(
            "capabilityTier", ""
        ).strip():
            errors.append("done task requires a capabilityTier")
        if not isinstance(review, dict) or review.get("approved") is not True:
            errors.append("done task requires review.approved=true")
        if not isinstance(validation, dict) or validation.get("finalInitPassed") is not True:
            errors.append("done task requires validation.finalInitPassed=true")
    return errors


def checkpoint_errors(path: Path) -> list[str]:
    if not path.is_file() or path.is_symlink():
        return []
    try:
        content = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        return [f"invalid task-context.toon: {exc}"]
    required = {
        "objective": ("objective",),
        "decisions": ("decisions",),
        "files": ("files",),
        "tests/checks": ("tests", "checks"),
        "blockers": ("blockers",),
        "next steps": ("next_steps",),
    }
    errors: list[str] = []
    for label, alternatives in required.items():
        if not any(re.search(rf"(?m)^\s*{re.escape(field)}\s*:", content) for field in alternatives):
            errors.append(f"task-context.toon missing field: {label}")
    return errors


def validate_skill(root: Path) -> list[str]:
    errors: list[str] = []
    for relative in SKILL_REQUIRED:
        path = root / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing or empty: {relative}")

    skill_file = root / "SKILL.md"
    if skill_file.is_file():
        content = skill_file.read_text(encoding="utf-8")
        match = re.match(r"\A---\n(.*?)\n---\n", content, re.DOTALL)
        if not match:
            errors.append("SKILL.md must start with YAML frontmatter")
        else:
            keys = [line.split(":", 1)[0] for line in match.group(1).splitlines() if ":" in line]
            if keys != ["name", "description"]:
                errors.append("SKILL.md frontmatter must contain only name and description")
            if "name: custom-harness" not in match.group(1):
                errors.append("SKILL.md name must be custom-harness")
        if re.search(r"\bTODO\b", content):
            errors.append("SKILL.md contains a TODO placeholder")

    for platform, required in INSTALLED_REQUIRED.items():
        base = root / "assets" / "templates" / platform
        for relative in required:
            if not (base / relative).is_file():
                errors.append(f"{platform} template missing: {relative}")
        errors.extend(semantic_errors(base, platform))
    shared = root / "assets" / "templates" / "shared"
    errors.extend(task_status_errors(shared / ".harness" / "task-status.json"))
    errors.extend(checkpoint_errors(shared / ".harness" / "context" / "task-context.toon"))
    return errors


def validate_target(target: Path, platforms: list[str]) -> list[str]:
    errors: list[str] = []
    common = (
        ".harness/config.toml",
        ".harness/task-status.json",
        ".harness/context/task-context.toon",
    )
    for relative in (*common, *(item for platform in platforms for item in INSTALLED_REQUIRED[platform])):
        path = target / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
            errors.append(f"missing or empty: {relative}")

    status_path = target / ".harness" / "task-status.json"
    checkpoint_path = target / ".harness" / "context" / "task-context.toon"
    errors.extend(task_status_errors(status_path))
    errors.extend(checkpoint_errors(checkpoint_path))
    for platform in platforms:
        errors.extend(semantic_errors(target, platform))
    return errors


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--skill-root", type=Path)
    group.add_argument("--target", type=Path)
    parser.add_argument(
        "--platform",
        action="append",
        choices=tuple(INSTALLED_REQUIRED),
        dest="platforms",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.skill_root:
        errors = validate_skill(args.skill_root.resolve())
    else:
        errors = validate_target(args.target.resolve(), args.platforms or ["codex"])
    if errors:
        for error in errors:
            print(f"error: {error}", file=sys.stderr)
        return 1
    print("custom-harness: validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
