from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import tomllib
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
    def install(self, target: Path, *platforms: str) -> None:
        arguments = ["--target", str(target)]
        for platform in platforms:
            arguments.extend(["--platform", platform])
        self.assertEqual(0, INSTALLER.main(arguments))

    def test_skill_source_is_valid(self) -> None:
        self.assertEqual([], VALIDATOR.validate_skill(ROOT))

    def test_all_installed_adapters_are_valid_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "consumer"
            target.mkdir()
            platforms = ("codex", "claude", "cursor")
            self.install(target, *platforms)

            self.assertEqual([], VALIDATOR.validate_target(target, list(platforms)))
            self.assertEqual(
                (ROOT / "scripts/workflow_state.py").read_text(encoding="utf-8"),
                (target / ".harness/bin/workflow_state.py").read_text(encoding="utf-8"),
            )

    def test_codex_uses_real_toml_agents_and_discoverable_skill(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "codex")

            for role in ("leader", "implementer", "reviewer"):
                data = tomllib.loads((target / f".codex/agents/{role}.toml").read_text(encoding="utf-8"))
                self.assertEqual(role, data["name"])
                self.assertTrue(data["description"])
                self.assertTrue(data["developer_instructions"])
                self.assertNotIn("model", data)
                self.assertFalse((target / f".agents/{role}.md").exists())
            self.assertTrue((target / ".agents/skills/custom-harness/SKILL.md").is_file())

    def test_claude_uses_native_agents_and_discoverable_skill(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "claude")

            for role in ("leader", "implementer", "reviewer"):
                content = (target / f".claude/agents/{role}.md").read_text(encoding="utf-8")
                metadata, errors = VALIDATOR.frontmatter(content, role)
                self.assertEqual([], errors)
                self.assertEqual(role, metadata["name"])
            self.assertTrue((target / ".claude/skills/custom-harness/SKILL.md").is_file())

    def test_cursor_rule_requires_explicit_degraded_review_contract(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "cursor")
            rule = target / ".cursor/rules/custom-harness.mdc"
            content = rule.read_text(encoding="utf-8")
            content = content.replace("Record `review-isolation:<reason>`", "Record a limitation")
            content = content.replace("a `review-pass`, never an independent review", "a review")
            rule.write_text(content, encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            self.assertTrue(any("degraded review" in error for error in errors), errors)
            self.assertTrue(any("review pass label" in error for error in errors), errors)
            self.assertTrue(any("independent warning" in error for error in errors), errors)

    def test_each_role_file_is_validated_in_its_native_format(self) -> None:
        cases = {
            "codex": ".codex/agents/leader.toml",
            "claude": ".claude/agents/leader.md",
        }
        for platform, relative in cases.items():
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary)
                self.install(target, platform)
                (target / relative).write_text("garbage\n", encoding="utf-8")

                errors = VALIDATOR.validate_target(target, [platform])

                self.assertTrue(any(role in error for error in errors for role in ("invalid TOML", "frontmatter")), errors)

    def test_forbidden_state_clearing_and_percentage_checkpoint_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "codex")
            dispatcher = target / "AGENTS.md"
            dispatcher.write_text(
                dispatcher.read_text(encoding="utf-8")
                + "\nClear task-status.json after approval. Checkpoint near 40%.\n",
                encoding="utf-8",
            )

            errors = VALIDATOR.validate_target(target, ["codex"])

            self.assertTrue(any("state clearing instruction" in error for error in errors), errors)
            self.assertTrue(any("ambiguous percentage checkpoint" in error for error in errors), errors)

    def test_codex_obsolete_markdown_role_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "codex")
            (target / ".agents/leader.md").write_text("# Legacy leader\n", encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["codex"])

            self.assertTrue(any("obsolete role contract" in error for error in errors), errors)

    def test_nonempty_garbage_dispatcher_is_rejected_semantically(self) -> None:
        for platform, relative in {
            "codex": "AGENTS.md",
            "claude": "CLAUDE.md",
            "cursor": ".cursor/rules/custom-harness.mdc",
        }.items():
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as temporary:
                target = Path(temporary)
                self.install(target, platform)
                (target / relative).write_text("# Garbage adapter\n", encoding="utf-8")

                errors = VALIDATOR.validate_target(target, [platform])

                self.assertTrue(any("semantic invariant missing" in error for error in errors), errors)

    def test_binary_adapter_is_rejected_without_crashing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "cursor")
            (target / ".cursor/rules/custom-harness.mdc").write_bytes(b"\xff\xfe\x00")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            self.assertTrue(any("not readable UTF-8" in error for error in errors), errors)

    def test_checkpoint_requires_observable_trigger_and_sequence_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            self.install(target, "cursor")
            checkpoint = target / ".harness/context/task-context.toon"
            checkpoint.write_text("objective: \"x\"\n", encoding="utf-8")

            errors = VALIDATOR.validate_target(target, ["cursor"])

            for field in ("trigger", "phase", "next_phase", "state_sequence", "actor_role", "actor_id"):
                self.assertTrue(any(f"missing field: {field}" in error for error in errors), errors)

    def test_task_status_requires_complete_v2_schema(self) -> None:
        errors = VALIDATOR.WORKFLOW.state_errors({})

        for field in VALIDATOR.WORKFLOW.default_state():
            self.assertTrue(any(f"missing field: {field}" in error for error in errors), errors)

    def test_tampered_state_evidence_chain_is_rejected(self) -> None:
        state = VALIDATOR.WORKFLOW.default_state()
        state.update({"task": "x", "branch": "review", "phase": "initialized"})
        state["validation"].update({"initialInitPassed": True, "initialInitCommand": "./init.sh"})
        state["evidence"] = [
            {
                "sequence": 2,
                "timestamp": "2026-01-01T00:00:00Z",
                "branch": "review",
                "from": "wrong",
                "to": "initialized",
                "actorRole": "leader",
                "actorId": "a",
                "summary": "bad",
            }
        ]

        errors = VALIDATOR.WORKFLOW.state_errors(state)

        self.assertTrue(any("sequence" in error for error in errors), errors)
        self.assertTrue(any("chain" in error for error in errors), errors)
        self.assertTrue(any("actor role" in error for error in errors), errors)

    def test_state_engine_with_command_execution_primitive_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            engine = Path(temporary) / "workflow_state.py"
            engine.write_text("import subprocess\nsubprocess.run(['echo'])\n", encoding="utf-8")

            errors = VALIDATOR.engine_errors(engine)

            self.assertTrue(any("must not import" in error for error in errors), errors)
            self.assertTrue(any("must not execute" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
