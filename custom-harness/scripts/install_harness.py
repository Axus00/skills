#!/usr/bin/env python3
"""Install Custom Harness templates with preflighted, idempotent writes."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_ROOT = SKILL_ROOT / "assets" / "templates"
PLATFORMS = ("codex", "claude", "cursor")


@dataclass(frozen=True)
class PlannedFile:
    relative_path: Path
    content: str
    action: str
    backup_path: Path | None = None
    reason: str | None = None


def template_files(platforms: list[str], project_name: str) -> dict[Path, str]:
    selected = ["shared", *dict.fromkeys(platforms)]
    files: dict[Path, str] = {}
    for group in selected:
        base = TEMPLATE_ROOT / group
        if not base.is_dir():
            raise ValueError(f"Missing template group: {group}")
        for source in sorted(path for path in base.rglob("*") if path.is_file()):
            relative = source.relative_to(base)
            rendered = source.read_text(encoding="utf-8").replace(
                "{{PROJECT_NAME_TOML}}", json.dumps(project_name, ensure_ascii=False)
            )
            previous = files.get(relative)
            if previous is not None and previous != rendered:
                raise ValueError(f"Adapters render conflicting content for {relative}")
            files[relative] = rendered
    return files


def route_error(target: Path, relative: Path) -> str | None:
    if relative.is_absolute() or ".." in relative.parts:
        return "path is outside target"
    if not target.is_dir() or target.is_symlink():
        return "target must be a real directory"

    current = target
    closest_existing = target
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink():
            return f"symlink ancestor: {current.relative_to(target)}"
        if current.exists():
            if not current.is_dir():
                return f"non-directory ancestor: {current.relative_to(target)}"
            closest_existing = current
    if not os.access(closest_existing, os.W_OK | os.X_OK):
        return f"parent is not writable: {closest_existing.relative_to(target)}"
    return None


def next_backup_path(target: Path, relative: Path, reserved: set[Path]) -> tuple[Path, str | None]:
    base = Path(".harness") / "backups" / relative
    candidate = base.with_name(f"{base.name}.bak")
    counter = 1
    while candidate in reserved or (target / candidate).exists() or (target / candidate).is_symlink():
        if (target / candidate).is_symlink():
            return candidate, "candidate is a symlink"
        candidate = base.with_name(f"{base.name}.bak.{counter}")
        counter += 1
    return candidate, None


def build_plan(target: Path, rendered: dict[Path, str], force: bool) -> list[PlannedFile]:
    plan: list[PlannedFile] = []
    for relative, content in sorted(rendered.items(), key=lambda item: str(item[0])):
        destination = target / relative
        reason = route_error(target, relative)
        if reason:
            action = "collision"
        elif destination.is_symlink():
            action = "collision"
            reason = "destination is a symlink"
        elif not destination.exists():
            action = "create"
        elif not destination.is_file():
            action = "collision"
            reason = "destination is not a regular file"
        elif os.lstat(destination).st_nlink > 1:
            action = "collision"
            reason = "destination has multiple hard links"
        else:
            try:
                matches = destination.read_text(encoding="utf-8") == content
            except UnicodeDecodeError:
                matches = False
            action = "unchanged" if matches else ("replace" if force else "collision")
            if action == "collision":
                reason = "destination has different content"
        plan.append(PlannedFile(relative, content, action, reason=reason))

    reserved: set[Path] = set()
    destinations = set(rendered)
    with_backups: list[PlannedFile] = []
    for item in plan:
        if item.action != "replace":
            with_backups.append(item)
            continue
        backup, selection_error = next_backup_path(target, item.relative_path, reserved)
        if any(
            backup == destination
            or backup in destination.parents
            or destination in backup.parents
            for destination in destinations
        ):
            selection_error = "conflicts with a planned destination"
        if any(
            backup in previous.parents or previous in backup.parents
            for previous in reserved
        ):
            selection_error = "conflicts with another planned backup"
        reserved.add(backup)
        reason = selection_error or route_error(target, backup)
        backup_destination = target / backup
        if reason:
            with_backups.append(
                PlannedFile(item.relative_path, item.content, "collision", backup, f"backup {reason}")
            )
        elif backup_destination.exists() or backup_destination.is_symlink():
            with_backups.append(
                PlannedFile(item.relative_path, item.content, "collision", backup, "backup path is occupied")
            )
        else:
            with_backups.append(
                PlannedFile(item.relative_path, item.content, item.action, backup_path=backup)
            )
    return with_backups


def apply_plan(target: Path, plan: list[PlannedFile], dry_run: bool) -> int:
    collisions = [item for item in plan if item.action == "collision"]
    for item in plan:
        detail = f" ({item.reason})" if item.reason else ""
        print(f"{item.action:9} {item.relative_path.as_posix()}{detail}")
    if collisions:
        print("Installation aborted before writes: resolve collisions or explicitly use --force.", file=sys.stderr)
        return 2
    if dry_run:
        return 0

    for item in plan:
        if item.action != "replace":
            continue
        if item.backup_path is None:
            raise RuntimeError(f"Missing preflighted backup for {item.relative_path}")
        source = target / item.relative_path
        backup = target / item.backup_path
        source_error = route_error(target, item.relative_path)
        backup_error = route_error(target, item.backup_path)
        if (
            source_error
            or source.is_symlink()
            or not source.is_file()
            or os.lstat(source).st_nlink > 1
            or backup_error
            or backup.exists()
            or backup.is_symlink()
        ):
            raise RuntimeError(f"Filesystem changed after preflight for {item.relative_path}")
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, backup)
        print(f"backup    {item.backup_path.as_posix()}")

    for item in plan:
        destination = target / item.relative_path
        if item.action == "unchanged":
            continue
        destination_error = route_error(target, item.relative_path)
        if (
            destination_error
            or destination.is_symlink()
            or (
                destination.exists()
                and (not destination.is_file() or os.lstat(destination).st_nlink > 1)
            )
        ):
            raise RuntimeError(f"Filesystem changed after preflight for {item.relative_path}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(item.content, encoding="utf-8")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", type=Path, default=Path.cwd())
    parser.add_argument(
        "--platform",
        action="append",
        choices=PLATFORMS,
        dest="platforms",
        help="Adapter to install; repeat for multiple platforms (default: codex).",
    )
    parser.add_argument("--project-name", help="Value for the generated consumer configuration.")
    parser.add_argument("--dry-run", action="store_true", help="Print the complete plan without writing.")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace divergent files after backing them up. Requires explicit authorization.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    target = Path(os.path.abspath(args.target))
    platforms = args.platforms or ["codex"]
    project_name = args.project_name or target.name
    rendered = template_files(platforms, project_name)
    plan = build_plan(target, rendered, args.force)
    return apply_plan(target, plan, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
