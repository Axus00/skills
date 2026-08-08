from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_script(name: str, filename: str):
    path = ROOT / "scripts" / filename
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


INSTALLER = load_script("install_harness_for_validation", "install_harness.py")
VALIDATOR = load_script("validate_harness", "validate_harness.py")


class ValidateHarnessTests(unittest.TestCase):
    def test_skill_source_is_valid(self) -> None:
        self.assertEqual([], VALIDATOR.validate_skill(ROOT))

    def test_all_installed_adapters_are_valid(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            platforms = ["codex", "claude", "cursor"]
            self.assertEqual(
                0,
                INSTALLER.main(
                    [
                        "--target",
                        str(target),
                        "--platform",
                        "codex",
                        "--platform",
                        "claude",
                        "--platform",
                        "cursor",
                    ]
                ),
            )

            self.assertEqual([], VALIDATOR.validate_target(target, platforms))

    def test_invalid_status_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            (target / ".harness/context").mkdir(parents=True)
            (target / ".harness/config.toml").write_text("schema_version = 1\n", encoding="utf-8")
            (target / ".harness/task-status.json").write_text('{"status":"unknown"}', encoding="utf-8")
            (target / ".harness/context/task-context.toon").write_text("objective: \"\"\n", encoding="utf-8")

            errors = VALIDATOR.validate_target(target, [])

            self.assertTrue(any("schemaVersion" in error for error in errors))
            self.assertTrue(any("status" in error for error in errors))

    def test_nonempty_garbage_adapter_files_are_rejected_semantically(self) -> None:
        primary_files = {
            "codex": "AGENTS.md",
            "claude": "CLAUDE.md",
            "cursor": ".cursor/rules/custom-harness.mdc",
        }
        for platform, primary_file in primary_files.items():
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary) / "consumer"
                target.mkdir()
                self.assertEqual(
                    0,
                    INSTALLER.main(
                        ["--target", str(target), "--platform", platform]
                    ),
                )
                (target / primary_file).write_text("# Garbage adapter\n", encoding="utf-8")

                errors = VALIDATOR.validate_target(target, [platform])

                self.assertTrue(
                    any(
                        error.startswith(f"{platform} ")
                        and "semantic invariant missing" in error
                        for error in errors
                    ),
                    errors,
                )

    def test_cursor_adapter_requires_explicit_degraded_independent_review(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            self.assertEqual(
                0,
                INSTALLER.main(["--target", str(target), "--platform", "cursor"]),
            )
            rule = target / ".cursor/rules/custom-harness.mdc"
            content = rule.read_text(encoding="utf-8")
            content = content.replace(
                "Use separate agent chats or CLI invocations for implementer and reviewer passes when native isolated subagents are unavailable; record that degraded capability and never claim independent review from one uninterrupted pass.\n",
                "Use implementer and reviewer passes.\n",
            )
            rule.write_text(content, encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            self.assertTrue(any("Cursor unavailable capability" in error for error in errors), errors)
            self.assertTrue(any("Cursor separate review execution" in error for error in errors), errors)
            self.assertTrue(any("Cursor degraded capability" in error for error in errors), errors)
            self.assertTrue(any("Cursor independent review warning" in error for error in errors), errors)

    def test_binary_garbage_adapter_is_rejected_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            self.assertEqual(
                0,
                INSTALLER.main(["--target", str(target), "--platform", "cursor"]),
            )
            (target / ".cursor/rules/custom-harness.mdc").write_bytes(b"\xff\xfe\x00")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            self.assertTrue(any("not readable UTF-8" in error for error in errors), errors)

    def test_each_codex_and_claude_role_file_enforces_its_own_contract(self) -> None:
        role_files = {
            "codex": (
                ".agents/leader.md",
                ".agents/implementer.md",
                ".agents/reviewer.md",
            ),
            "claude": (
                ".claude/agents/leader.md",
                ".claude/agents/implementer.md",
                ".claude/agents/reviewer.md",
            ),
        }
        for platform, relatives in role_files.items():
            for relative in relatives:
                with self.subTest(platform=platform, relative=relative), tempfile.TemporaryDirectory() as temporary:
                    target = Path(temporary) / "consumer"
                    target.mkdir()
                    self.assertEqual(
                        0,
                        INSTALLER.main(
                            ["--target", str(target), "--platform", platform]
                        ),
                    )
                    (target / relative).write_text("# Garbage role\n", encoding="utf-8")

                    errors = VALIDATOR.validate_target(target, [platform])

                    self.assertTrue(
                        any(relative in error and "semantic invariant missing" in error for error in errors),
                        errors,
                    )

    def test_checkpoint_garbage_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            self.assertEqual(
                0,
                INSTALLER.main(["--target", str(target), "--platform", "cursor"]),
            )
            checkpoint = target / ".harness/context/task-context.toon"
            checkpoint.write_text("garbage: true\n", encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            for field in ("objective", "decisions", "files", "tests/checks", "blockers", "next steps"):
                self.assertTrue(any(f"missing field: {field}" in error for error in errors), errors)

    def test_task_status_requires_complete_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            self.assertEqual(
                0,
                INSTALLER.main(["--target", str(target), "--platform", "cursor"]),
            )
            status_path = target / ".harness/task-status.json"
            status_path.write_text("{}\n", encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            for field in VALIDATOR.STATUS_FIELDS:
                self.assertTrue(any(f"missing field: {field}" in error for error in errors), errors)

    def test_done_status_requires_approved_review_and_final_init(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            self.assertEqual(
                0,
                INSTALLER.main(["--target", str(target), "--platform", "cursor"]),
            )
            status_path = target / ".harness/task-status.json"
            status = json.loads(status_path.read_text(encoding="utf-8"))
            status["status"] = "done"
            status_path.write_text(json.dumps(status), encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            self.assertTrue(any("review.approved=true" in error for error in errors), errors)
            self.assertTrue(any("validation.finalInitPassed=true" in error for error in errors), errors)

            status["review"] = {"approved": True}
            status["validation"] = {"finalInitPassed": True}
            status["task"] = "Validated task"
            status["classification"] = "small"
            status["capabilityTier"] = "fast"
            status_path.write_text(json.dumps(status), encoding="utf-8")

            self.assertEqual([], VALIDATOR.validate_target(target, ["cursor"]))


if __name__ == "__main__":
    unittest.main()
