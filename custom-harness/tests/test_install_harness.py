from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "install_harness.py"
SPEC = importlib.util.spec_from_file_location("install_harness", SCRIPT_PATH)
assert SPEC and SPEC.loader
INSTALLER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = INSTALLER
SPEC.loader.exec_module(INSTALLER)


class InstallHarnessTests(unittest.TestCase):
    def test_install_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()

            self.assertEqual(0, INSTALLER.main(["--target", str(target), "--platform", "codex"]))
            status_before = (target / ".harness/task-status.json").read_text(encoding="utf-8")
            plan = INSTALLER.build_plan(
                target,
                INSTALLER.template_files(["codex"], target.name),
                force=False,
            )

            self.assertTrue(plan)
            self.assertTrue(all(item.action == "unchanged" for item in plan))
            self.assertEqual(0, INSTALLER.apply_plan(target, plan, dry_run=False))
            self.assertEqual(status_before, (target / ".harness/task-status.json").read_text(encoding="utf-8"))

    def test_dry_run_writes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()

            result = INSTALLER.main(["--target", str(target), "--platform", "cursor", "--dry-run"])

            self.assertEqual(0, result)
            self.assertEqual([], list(target.iterdir()))

    def test_project_name_is_toml_escaped(self) -> None:
        rendered = INSTALLER.template_files(["cursor"], 'quoted "name"')

        self.assertIn('project_name = "quoted \\"name\\""', rendered[Path(".harness/config.toml")])

    def test_collision_aborts_before_any_write(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            (target / "AGENTS.md").write_text("# Existing\n", encoding="utf-8")

            result = INSTALLER.main(["--target", str(target), "--platform", "codex"])

            self.assertEqual(2, result)
            self.assertEqual("# Existing\n", (target / "AGENTS.md").read_text(encoding="utf-8"))
            self.assertFalse((target / ".harness").exists())

    def test_force_replacement_creates_backup(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            (target / "AGENTS.md").write_text("# Existing\n", encoding="utf-8")

            result = INSTALLER.main(
                ["--target", str(target), "--platform", "codex", "--force"]
            )

            self.assertEqual(0, result)
            backup = target / ".harness/backups/AGENTS.md.bak"
            self.assertEqual("# Existing\n", backup.read_text(encoding="utf-8"))
            self.assertIn("# Custom Harness Instructions", (target / "AGENTS.md").read_text(encoding="utf-8"))

    def test_force_does_not_follow_symlinked_destination(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            outside = Path(temporary) / "outside.md"
            outside.write_text("# Outside\n", encoding="utf-8")
            (target / "AGENTS.md").symlink_to(outside)

            result = INSTALLER.main(
                ["--target", str(target), "--platform", "codex", "--force"]
            )

            self.assertEqual(2, result)
            self.assertEqual("# Outside\n", outside.read_text(encoding="utf-8"))
            self.assertFalse((target / ".harness").exists())

    def test_force_aborts_when_backups_directory_is_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            outside = Path(temporary) / "outside"
            target.mkdir()
            outside.mkdir()
            (target / ".harness").mkdir()
            (target / ".harness/backups").symlink_to(outside, target_is_directory=True)
            (target / "AGENTS.md").write_text("# Existing\n", encoding="utf-8")

            result = INSTALLER.main(
                ["--target", str(target), "--platform", "codex", "--force"]
            )

            self.assertEqual(2, result)
            self.assertEqual("# Existing\n", (target / "AGENTS.md").read_text(encoding="utf-8"))
            self.assertEqual([], list(outside.iterdir()))
            self.assertFalse((target / ".agents").exists())
            self.assertFalse((target / ".harness/config.toml").exists())

    def test_force_aborts_when_nested_backup_ancestor_is_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            outside = Path(temporary) / "outside"
            target.mkdir()
            outside.mkdir()
            (target / ".harness/backups").mkdir(parents=True)
            (target / ".harness/backups/.agents").symlink_to(outside, target_is_directory=True)
            (target / ".agents").mkdir()
            role = target / ".agents/leader.md"
            role.write_text("# Existing leader\n", encoding="utf-8")

            result = INSTALLER.main(
                ["--target", str(target), "--platform", "codex", "--force"]
            )

            self.assertEqual(2, result)
            self.assertEqual("# Existing leader\n", role.read_text(encoding="utf-8"))
            self.assertEqual([], list(outside.iterdir()))
            self.assertFalse((target / "AGENTS.md").exists())
            self.assertFalse((target / ".harness/config.toml").exists())

    def test_force_preflights_non_directory_backup_path_before_writes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            (target / ".harness").mkdir()
            (target / ".harness/backups").write_text("occupied\n", encoding="utf-8")
            (target / "AGENTS.md").write_text("# Existing\n", encoding="utf-8")

            result = INSTALLER.main(
                ["--target", str(target), "--platform", "codex", "--force"]
            )

            self.assertEqual(2, result)
            self.assertEqual("# Existing\n", (target / "AGENTS.md").read_text(encoding="utf-8"))
            self.assertEqual("occupied\n", (target / ".harness/backups").read_text(encoding="utf-8"))
            self.assertFalse((target / ".agents").exists())
            self.assertFalse((target / ".harness/config.toml").exists())

    def test_backup_cannot_overlap_a_planned_destination(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            source = target / "source.txt"
            source.write_text("existing\n", encoding="utf-8")
            backup_destination = Path(".harness/backups/source.txt.bak")
            rendered = {
                Path("source.txt"): "replacement\n",
                backup_destination: "planned content\n",
            }

            plan = INSTALLER.build_plan(target, rendered, force=True)
            result = INSTALLER.apply_plan(target, plan, dry_run=False)

            self.assertEqual(2, result)
            self.assertEqual("existing\n", source.read_text(encoding="utf-8"))
            self.assertFalse((target / ".harness").exists())

    def test_target_symlink_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            outside = Path(temporary) / "outside"
            target = Path(temporary) / "consumer"
            outside.mkdir()
            target.symlink_to(outside, target_is_directory=True)

            result = INSTALLER.main(["--target", str(target), "--platform", "cursor"])

            self.assertEqual(2, result)
            self.assertEqual([], list(outside.iterdir()))

    def test_force_rejects_hardlinked_destination_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            outside = Path(temporary) / "outside.md"
            target.mkdir()
            outside.write_text("# Shared inode\n", encoding="utf-8")
            destination = target / "AGENTS.md"
            os.link(outside, destination)
            inode = outside.stat().st_ino

            result = INSTALLER.main(
                ["--target", str(target), "--platform", "codex", "--force"]
            )

            self.assertEqual(2, result)
            self.assertEqual("# Shared inode\n", outside.read_text(encoding="utf-8"))
            self.assertEqual("# Shared inode\n", destination.read_text(encoding="utf-8"))
            self.assertEqual(inode, outside.stat().st_ino)
            self.assertEqual(inode, destination.stat().st_ino)
            self.assertFalse((target / ".agents").exists())
            self.assertFalse((target / ".harness").exists())


if __name__ == "__main__":
    unittest.main()
