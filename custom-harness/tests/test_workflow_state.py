from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/workflow_state.py"
SPEC = importlib.util.spec_from_file_location("workflow_state_for_tests", SCRIPT)
assert SPEC and SPEC.loader
WORKFLOW = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = WORKFLOW
SPEC.loader.exec_module(WORKFLOW)


class WorkflowStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.state_path = self.root / ".harness/task-status.json"
        self.checkpoint_path = self.root / ".harness/context/task-context.toon"
        self.checkpoint_path.parent.mkdir(parents=True)
        self.state_path.write_text(
            json.dumps(WORKFLOW.default_state(), indent=2) + "\n", encoding="utf-8"
        )
        self.checkpoint_path.write_text("objective: \"\"\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def call(self, action: str, *arguments: str) -> int:
        return WORKFLOW.main(
            [
                action,
                "--state",
                str(self.state_path),
                *arguments,
            ]
        )

    def transition(self, target: str, role: str, identity: str, *extra: str) -> int:
        return self.call(
            "transition",
            "--checkpoint",
            str(self.checkpoint_path),
            "--to",
            target,
            "--actor-role",
            role,
            "--actor-id",
            identity,
            "--evidence",
            f"evidence for {target}",
            *extra,
        )

    def checkpoint(self, target: str, role: str, identity: str) -> int:
        trigger = "before-delegation" if target == "delegated" else "before-phase-change"
        return self.call(
            "checkpoint",
            "--checkpoint",
            str(self.checkpoint_path),
            "--trigger",
            trigger,
            "--next-phase",
            target,
            "--actor-role",
            role,
            "--actor-id",
            identity,
            "--decision",
            f"advance to {target}",
            "--next-step",
            target,
        )

    def initialize(self, branch: str) -> None:
        self.assertEqual(
            0,
            self.transition(
                "initialized",
                "dispatcher",
                "dispatcher-1",
                "--task",
                "Test task",
                "--branch",
                branch,
                "--command",
                "./init.sh",
                "--exit-code",
                "0",
            ),
        )

    def analyze(self) -> None:
        self.assertEqual(0, self.checkpoint("analyzed", "leader", "leader-1"))
        self.assertEqual(
            0,
            self.transition(
                "analyzed",
                "leader",
                "leader-1",
                "--classification",
                "large",
                "--capability-tier",
                "strongest-suitable",
                "--selected-model",
                "runtime-model",
            ),
        )

    def request_review(self, reviewer: str = "reviewer-1", *extra: str) -> int:
        self.assertEqual(0, self.checkpoint("review-pending", "leader", "leader-1"))
        return self.transition(
            "review-pending",
            "leader",
            "leader-1",
            "--reviewer-id",
            reviewer,
            *extra,
        )

    def approve(self, branch: str, reviewer: str = "reviewer-1") -> None:
        self.assertEqual(0, self.checkpoint("review-approved", "reviewer", reviewer))
        checks: list[str] = []
        for check in sorted(WORKFLOW.REQUIRED_REVIEW_CHECKS[branch]):
            checks.extend(["--review-check", check])
        self.assertEqual(
            0,
            self.transition("review-approved", "reviewer", reviewer, *checks),
        )

    def finish(self) -> None:
        self.assertEqual(0, self.checkpoint("final-init-passed", "leader", "leader-1"))
        self.assertEqual(
            0,
            self.transition(
                "final-init-passed",
                "leader",
                "leader-1",
                "--command",
                "./init.sh",
                "--exit-code",
                "0",
            ),
        )
        self.assertEqual(0, self.checkpoint("done", "leader", "leader-1"))
        self.assertEqual(0, self.transition("done", "leader", "leader-1"))

    def completed_review_state(
        self,
        reviewer: str = "reviewer-1",
        degraded_reason: str | None = None,
    ) -> dict:
        extra = ("--degraded-review", degraded_reason) if degraded_reason else ()
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            self.initialize("review")
            self.analyze()
            self.assertEqual(0, self.request_review(reviewer, *extra))
            self.approve("review", reviewer)
            self.finish()
        return WORKFLOW.load_state(self.state_path)

    def assert_invalid_state(self, state: dict, expected_error: str) -> None:
        errors = WORKFLOW.state_errors(state)
        self.assertTrue(
            any(expected_error in error for error in errors),
            f"expected {expected_error!r} in {errors!r}",
        )
        self.state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            self.assertEqual(1, self.call("check"))

    @staticmethod
    def event(state: dict, target: str) -> dict:
        return next(event for event in state["evidence"] if event["to"] == target)

    def test_review_branch_end_to_end_skips_implementation_and_distribution(self) -> None:
        self.initialize("review")
        self.analyze()
        self.assertEqual(0, self.request_review())
        self.approve("review")
        self.finish()

        state = WORKFLOW.load_state(self.state_path)
        self.assertEqual("done", state["phase"])
        self.assertEqual([], state["actors"]["implementer"])
        self.assertNotIn("distribution", state["review"]["checks"])
        self.assertEqual([], WORKFLOW.state_errors(state))

    def run_delivery_branch(self, branch: str) -> dict:
        self.initialize(branch)
        self.analyze()
        self.assertEqual(0, self.checkpoint("delegated", "leader", "leader-1"))
        self.assertEqual(
            0,
            self.transition(
                "delegated",
                "leader",
                "leader-1",
                "--delegate-id",
                "implementer-1",
            ),
        )
        self.assertEqual(0, self.checkpoint("implemented", "implementer", "implementer-1"))
        self.assertEqual(0, self.transition("implemented", "implementer", "implementer-1"))
        self.assertEqual(0, self.checkpoint("tested", "implementer", "implementer-1"))
        self.assertEqual(0, self.transition("tested", "implementer", "implementer-1"))
        self.assertEqual(0, self.request_review())
        self.approve(branch)
        self.finish()
        return WORKFLOW.load_state(self.state_path)

    def test_install_adapt_branch_end_to_end(self) -> None:
        state = self.run_delivery_branch("install-adapt")

        self.assertEqual("done", state["status"])
        self.assertNotIn("distribution", state["review"]["checks"])
        self.assertEqual([], WORKFLOW.state_errors(state))

    def test_package_branch_end_to_end_requires_distribution(self) -> None:
        state = self.run_delivery_branch("package")

        self.assertIn("distribution", state["review"]["checks"])
        self.assertEqual([], WORKFLOW.state_errors(state))

    def test_analysis_is_rejected_before_successful_init(self) -> None:
        result = self.transition(
            "analyzed",
            "leader",
            "leader-1",
            "--classification",
            "small",
            "--capability-tier",
            "fast",
            "--selected-model",
            "runtime-model",
        )

        self.assertEqual(2, result)
        self.assertEqual("uninitialized", WORKFLOW.load_state(self.state_path)["phase"])

    def test_failed_initial_init_is_rejected(self) -> None:
        result = self.transition(
            "initialized",
            "dispatcher",
            "dispatcher-1",
            "--task",
            "Test task",
            "--branch",
            "review",
            "--command",
            "./init.sh",
            "--exit-code",
            "1",
        )

        self.assertEqual(2, result)
        self.assertFalse(WORKFLOW.load_state(self.state_path)["validation"]["initialInitPassed"])

    def test_post_init_transition_requires_fresh_checkpoint(self) -> None:
        self.initialize("review")

        result = self.transition(
            "analyzed",
            "leader",
            "leader-1",
            "--classification",
            "small",
            "--capability-tier",
            "fast",
            "--selected-model",
            "runtime-model",
        )

        self.assertEqual(2, result)
        self.assertEqual("initialized", WORKFLOW.load_state(self.state_path)["phase"])

    def test_checkpoint_actor_must_match_transition_actor(self) -> None:
        self.initialize("review")
        self.assertEqual(0, self.checkpoint("analyzed", "leader", "leader-1"))

        result = self.transition(
            "analyzed",
            "leader",
            "leader-2",
            "--classification",
            "small",
            "--capability-tier",
            "fast",
            "--selected-model",
            "runtime-model",
        )

        self.assertEqual(2, result)
        self.assertEqual("initialized", WORKFLOW.load_state(self.state_path)["phase"])

    def test_analysis_requires_capability_tier_and_selected_model(self) -> None:
        self.initialize("review")
        self.assertEqual(0, self.checkpoint("analyzed", "leader", "leader-1"))

        result = self.transition(
            "analyzed",
            "leader",
            "leader-1",
            "--classification",
            "small",
            "--capability-tier",
            "fast",
        )

        self.assertEqual(2, result)

    def test_shared_reviewer_identity_requires_explicit_degradation(self) -> None:
        self.initialize("review")
        self.analyze()
        self.assertEqual(2, self.request_review("leader-1"))
        self.assertEqual(
            0,
            self.request_review("leader-1", "--degraded-review", "cursor-no-native-isolation"),
        )

        state = WORKFLOW.load_state(self.state_path)
        self.assertFalse(state["review"]["independent"])
        self.assertEqual("review-pass", state["review"]["mode"])
        self.assertIn("review-isolation:cursor-no-native-isolation", state["degradedCapabilities"])

    def test_review_approval_requires_branch_specific_checks(self) -> None:
        self.initialize("package")
        self.analyze()
        self.assertEqual(0, self.checkpoint("delegated", "leader", "leader-1"))
        self.assertEqual(0, self.transition("delegated", "leader", "leader-1", "--delegate-id", "implementer-1"))
        self.assertEqual(0, self.checkpoint("implemented", "implementer", "implementer-1"))
        self.assertEqual(0, self.transition("implemented", "implementer", "implementer-1"))
        self.assertEqual(0, self.checkpoint("tested", "implementer", "implementer-1"))
        self.assertEqual(0, self.transition("tested", "implementer", "implementer-1"))
        self.assertEqual(0, self.request_review())
        self.assertEqual(0, self.checkpoint("review-approved", "reviewer", "reviewer-1"))
        checks: list[str] = []
        for check in sorted(WORKFLOW.REQUIRED_REVIEW_CHECKS["package"] - {"distribution"}):
            checks.extend(["--review-check", check])

        result = self.transition("review-approved", "reviewer", "reviewer-1", *checks)

        self.assertEqual(2, result)
        self.assertEqual("review-pending", WORKFLOW.load_state(self.state_path)["phase"])

    def test_done_is_rejected_before_final_init(self) -> None:
        self.initialize("review")
        self.analyze()
        self.assertEqual(0, self.request_review())
        self.approve("review")
        result = self.transition("done", "leader", "leader-1")

        self.assertEqual(2, result)
        self.assertEqual("review-approved", WORKFLOW.load_state(self.state_path)["phase"])

    def test_rejected_delivery_review_returns_to_delegated(self) -> None:
        self.initialize("install-adapt")
        self.analyze()
        self.assertEqual(0, self.checkpoint("delegated", "leader", "leader-1"))
        self.assertEqual(0, self.transition("delegated", "leader", "leader-1", "--delegate-id", "implementer-1"))
        self.assertEqual(0, self.checkpoint("implemented", "implementer", "implementer-1"))
        self.assertEqual(0, self.transition("implemented", "implementer", "implementer-1"))
        self.assertEqual(0, self.checkpoint("tested", "implementer", "implementer-1"))
        self.assertEqual(0, self.transition("tested", "implementer", "implementer-1"))
        self.assertEqual(0, self.request_review())
        self.assertEqual(0, self.checkpoint("review-rejected", "reviewer", "reviewer-1"))
        self.assertEqual(0, self.transition("review-rejected", "reviewer", "reviewer-1"))
        self.assertEqual(0, self.checkpoint("delegated", "leader", "leader-1"))

        result = self.transition("delegated", "leader", "leader-1", "--delegate-id", "implementer-2")

        self.assertEqual(0, result)
        self.assertEqual("delegated", WORKFLOW.load_state(self.state_path)["phase"])

    def test_persisted_event_branch_must_match_task_branch(self) -> None:
        state = self.completed_review_state()
        self.event(state, "analyzed")["branch"] = "package"

        self.assert_invalid_state(state, "evidence branch 2 does not match task branch")

    def test_persisted_actor_identity_must_match_role_assignments(self) -> None:
        state = self.completed_review_state()
        state["actors"]["leader"] = []

        self.assert_invalid_state(state, "actors do not match evidence assignments")

    def test_persisted_implementer_event_requires_prior_delegation(self) -> None:
        with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
            state = self.run_delivery_branch("install-adapt")
        self.event(state, "delegated")["delegateId"] = "implementer-2"
        state["actors"]["implementer"] = ["implementer-2", "implementer-1"]

        self.assert_invalid_state(state, "was not delegated as implementer")

    def test_persisted_reviewer_event_must_use_assigned_reviewer(self) -> None:
        state = self.completed_review_state()
        self.event(state, "review-approved")["actorId"] = "reviewer-2"
        state["actors"]["reviewer"].append("reviewer-2")

        self.assert_invalid_state(state, "does not match assigned reviewerId")

    def test_persisted_reviewer_id_must_be_registered(self) -> None:
        state = self.completed_review_state()
        state["review"]["reviewerId"] = "reviewer-2"

        self.assert_invalid_state(state, "reviewerId is not registered")

    def test_persisted_independent_review_requires_separate_identity(self) -> None:
        state = self.completed_review_state()
        pending = self.event(state, "review-pending")
        pending.update(
            {
                "reviewerId": "leader-1",
                "independent": True,
                "mode": "independent-review",
            }
        )
        self.event(state, "review-approved")["actorId"] = "leader-1"
        state["actors"]["reviewer"] = ["leader-1"]
        state["review"].update(
            {
                "reviewerId": "leader-1",
                "independent": True,
                "mode": "independent-review",
            }
        )

        self.assert_invalid_state(state, "requires a reviewer identity separate")

    def test_persisted_independent_review_rejects_isolation_degradation(self) -> None:
        state = self.completed_review_state()
        state["degradedCapabilities"] = ["review-isolation:forged"]

        self.assert_invalid_state(state, "must not have a review-isolation degradation")

    def test_persisted_review_pass_requires_shared_identity(self) -> None:
        state = self.completed_review_state()
        pending = self.event(state, "review-pending")
        pending.update(
            {
                "independent": False,
                "mode": "review-pass",
                "degradation": "review-isolation:forged",
            }
        )
        state["degradedCapabilities"] = ["review-isolation:forged"]
        state["review"].update({"independent": False, "mode": "review-pass"})

        self.assert_invalid_state(state, "requires a reviewer identity shared")

    def test_persisted_review_pass_requires_degradation(self) -> None:
        state = self.completed_review_state("leader-1", "cursor-no-native-isolation")
        self.event(state, "review-pending").pop("degradation")
        state["degradedCapabilities"] = []

        self.assert_invalid_state(state, "requires a coherent review-isolation degradation")

    def test_persisted_timestamp_must_be_valid_utc(self) -> None:
        state = self.completed_review_state()
        state["evidence"][0]["timestamp"] = "not-a-timestamp"

        self.assert_invalid_state(state, "evidence timestamp 1 is invalid")

    def test_persisted_timestamps_must_be_ordered(self) -> None:
        state = self.completed_review_state()
        state["evidence"][1]["timestamp"] = "2000-01-01T00:00:00Z"

        self.assert_invalid_state(state, "evidence timestamps are out of order")

    def test_persisted_initialization_requires_command(self) -> None:
        state = self.completed_review_state()
        self.event(state, "initialized").pop("command")

        self.assert_invalid_state(state, "initialized evidence requires command and exitCode=0")

    def test_persisted_initialization_requires_zero_integer_exit_code(self) -> None:
        state = self.completed_review_state()
        self.event(state, "initialized")["exitCode"] = False

        self.assert_invalid_state(state, "initialized evidence requires command and exitCode=0")

    def test_persisted_final_init_requires_command(self) -> None:
        state = self.completed_review_state()
        self.event(state, "final-init-passed").pop("command")

        self.assert_invalid_state(state, "final-init-passed evidence requires command and exitCode=0")

    def test_persisted_final_init_requires_zero_integer_exit_code(self) -> None:
        state = self.completed_review_state()
        self.event(state, "final-init-passed")["exitCode"] = 1

        self.assert_invalid_state(state, "final-init-passed evidence requires command and exitCode=0")

    def test_persisted_analysis_fields_must_match_evidence(self) -> None:
        state = self.completed_review_state()
        state["selectedModel"] = "forged-model"

        self.assert_invalid_state(state, "selectedModel does not match analyzed evidence")

    def test_persisted_evidence_rejects_fields_not_emitted_by_cli(self) -> None:
        state = self.completed_review_state()
        self.event(state, "analyzed")["command"] = "untrusted-command"

        self.assert_invalid_state(state, "has unexpected fields")

    def test_persisted_dependencies_cannot_bypass_cli(self) -> None:
        state = self.completed_review_state()
        state["dependencies"] = ["forged-dependency"]

        self.assert_invalid_state(state, "dependencies cannot be mutated")


if __name__ == "__main__":
    unittest.main()
