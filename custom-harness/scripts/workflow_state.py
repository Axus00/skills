#!/usr/bin/env python3
"""Record and validate Custom Harness workflow state without executing commands."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 2
BRANCHES = ("review", "install-adapt", "package")
CLASSIFICATIONS = ("small", "medium", "large")
ROLES = ("dispatcher", "leader", "implementer", "reviewer")
CHECKPOINT_TRIGGERS = (
    "before-phase-change",
    "before-delegation",
    "before-compaction",
    "before-handoff",
)

TRANSITIONS = {
    "review": {
        "uninitialized": {"initialized"},
        "initialized": {"analyzed"},
        "analyzed": {"review-pending"},
        "review-pending": {"review-approved", "review-rejected"},
        "review-rejected": {"analyzed"},
        "review-approved": {"final-init-passed"},
        "final-init-passed": {"done"},
        "done": set(),
    },
    "install-adapt": {
        "uninitialized": {"initialized"},
        "initialized": {"analyzed"},
        "analyzed": {"delegated"},
        "delegated": {"implemented"},
        "implemented": {"tested"},
        "tested": {"review-pending"},
        "review-pending": {"review-approved", "review-rejected"},
        "review-rejected": {"delegated"},
        "review-approved": {"final-init-passed"},
        "final-init-passed": {"done"},
        "done": set(),
    },
    "package": {
        "uninitialized": {"initialized"},
        "initialized": {"analyzed"},
        "analyzed": {"delegated"},
        "delegated": {"implemented"},
        "implemented": {"tested"},
        "tested": {"review-pending"},
        "review-pending": {"review-approved", "review-rejected"},
        "review-rejected": {"delegated"},
        "review-approved": {"final-init-passed"},
        "final-init-passed": {"done"},
        "done": set(),
    },
}

TARGET_ROLES = {
    "initialized": "dispatcher",
    "analyzed": "leader",
    "delegated": "leader",
    "implemented": "implementer",
    "tested": "implementer",
    "review-pending": "leader",
    "review-approved": "reviewer",
    "review-rejected": "reviewer",
    "final-init-passed": "leader",
    "done": "leader",
}

REQUIRED_REVIEW_CHECKS = {
    "review": {"requirements", "scope", "evidence", "consumer-policy"},
    "install-adapt": {
        "requirements",
        "scope",
        "behavior",
        "tests",
        "security",
        "state-transitions",
        "adapter-conformance",
        "consumer-policy",
    },
    "package": {
        "requirements",
        "scope",
        "behavior",
        "tests",
        "security",
        "state-transitions",
        "adapter-conformance",
        "distribution",
        "consumer-policy",
    },
}


class WorkflowError(ValueError):
    """Raised when a requested state mutation violates the workflow contract."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_state() -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "task": None,
        "branch": None,
        "classification": None,
        "status": "in-progress",
        "phase": "uninitialized",
        "evidence": [],
        "dependencies": [],
        "capabilityTier": None,
        "selectedModel": None,
        "degradedCapabilities": [],
        "actors": {role: [] for role in ROLES},
        "review": {
            "approved": None,
            "reviewerId": None,
            "independent": None,
            "mode": None,
            "checks": [],
        },
        "validation": {
            "initialInitPassed": False,
            "initialInitCommand": None,
            "finalInitPassed": False,
            "finalInitCommand": None,
        },
    }


def regular_file_error(path: Path, *, allow_missing: bool = False) -> str | None:
    if path.is_symlink():
        return f"path is a symlink: {path}"
    if not path.exists():
        return None if allow_missing else f"path does not exist: {path}"
    if not path.is_file():
        return f"path is not a regular file: {path}"
    if os.lstat(path).st_nlink > 1:
        return f"path has multiple hard links: {path}"
    return None


def load_state(path: Path) -> dict[str, Any]:
    problem = regular_file_error(path)
    if problem:
        raise WorkflowError(problem)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        raise WorkflowError(f"invalid state file: {exc}") from exc
    if not isinstance(value, dict):
        raise WorkflowError("state must be a JSON object")
    return value


def write_text_atomic(path: Path, content: str) -> None:
    problem = regular_file_error(path, allow_missing=True)
    if problem:
        raise WorkflowError(problem)
    if path.parent.is_symlink() or not path.parent.is_dir():
        raise WorkflowError(f"parent must be a real directory: {path.parent}")
    temporary = path.with_name(f".{path.name}.tmp")
    if temporary.exists() or temporary.is_symlink():
        raise WorkflowError(f"temporary path is occupied: {temporary}")
    try:
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, path)
    finally:
        if temporary.exists() and not temporary.is_symlink():
            temporary.unlink()


def write_state(path: Path, state: dict[str, Any]) -> None:
    write_text_atomic(path, json.dumps(state, ensure_ascii=False, indent=2) + "\n")


def nonempty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def valid_timestamp(value: Any) -> datetime | None:
    if not nonempty_string(value):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() != timedelta(0):
        return None
    return parsed


def append_unique(values: list[str], value: str) -> None:
    if value not in values:
        values.append(value)


def state_errors(state: Any) -> list[str]:
    if not isinstance(state, dict):
        return ["task-status.json must be an object"]

    errors: list[str] = []
    required_fields = set(default_state())
    for field in sorted(required_fields - set(state)):
        errors.append(f"task-status.json missing field: {field}")
    for field in sorted(set(state) - required_fields):
        errors.append(f"task-status.json unexpected field: {field}")
    if errors:
        return errors

    if state.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"task-status.json schemaVersion must be {SCHEMA_VERSION}")
    branch = state.get("branch")
    phase = state.get("phase")
    if branch not in {None, *BRANCHES}:
        errors.append("task-status.json branch is invalid")
    valid_phases = {"uninitialized"}
    if branch in TRANSITIONS:
        valid_phases.update(TRANSITIONS[branch])
    if phase not in valid_phases:
        errors.append("task-status.json phase is invalid for its branch")
    expected_status = "done" if phase == "done" else "in-progress"
    if state.get("status") != expected_status:
        errors.append(f"task-status.json status must be {expected_status} for phase {phase}")
    if state.get("task") is not None and not nonempty_string(state.get("task")):
        errors.append("task-status.json task must be a non-empty string or null")
    if state.get("classification") not in {None, *CLASSIFICATIONS}:
        errors.append("task-status.json classification is invalid")
    for field in ("evidence", "dependencies", "degradedCapabilities"):
        values = state.get(field)
        if not isinstance(values, list):
            errors.append(f"task-status.json {field} must be an array")
        elif field != "evidence" and (
            not all(nonempty_string(item) for item in values) or len(values) != len(set(values))
        ):
            errors.append(f"task-status.json {field} must contain unique non-empty strings")
    if isinstance(state.get("dependencies"), list) and state["dependencies"]:
        errors.append("task-status.json dependencies cannot be mutated by the workflow engine")
    for field in ("capabilityTier", "selectedModel"):
        if state.get(field) is not None and not nonempty_string(state.get(field)):
            errors.append(f"task-status.json {field} must be a non-empty string or null")

    actors = state.get("actors")
    if not isinstance(actors, dict):
        errors.append("task-status.json actors must be an object")
    else:
        if set(actors) != set(ROLES):
            errors.append("task-status.json actors must contain exactly the supported roles")
        for role in ROLES:
            values = actors.get(role)
            if (
                not isinstance(values, list)
                or not all(nonempty_string(item) for item in values)
                or len(values) != len(set(values))
            ):
                errors.append(f"task-status.json actors.{role} must be an array of unique identities")

    evidence = state.get("evidence")
    replayed_branch: str | None = None
    replayed_task: str | None = None
    replayed_classification: str | None = None
    replayed_capability_tier: str | None = None
    replayed_selected_model: str | None = None
    replayed_actors = {role: [] for role in ROLES}
    replayed_review = {
        "approved": None,
        "reviewerId": None,
        "independent": None,
        "mode": None,
        "checks": [],
    }
    replayed_validation = {
        "initialInitPassed": False,
        "initialInitCommand": None,
        "finalInitPassed": False,
        "finalInitCommand": None,
    }
    replayed_review_isolations: list[str] = []
    if isinstance(evidence, list):
        previous = "uninitialized"
        previous_timestamp: datetime | None = None
        for index, event in enumerate(evidence, start=1):
            if not isinstance(event, dict):
                errors.append(f"task-status.json evidence[{index - 1}] must be an object")
                continue
            target = event.get("to")
            actor_role = event.get("actorRole")
            actor_id = event.get("actorId")
            base_event_fields = {
                "sequence",
                "timestamp",
                "branch",
                "from",
                "to",
                "actorRole",
                "actorId",
                "summary",
            }
            target_event_fields = {
                "initialized": {"task", "command", "exitCode"},
                "analyzed": {"classification", "capabilityTier", "selectedModel"},
                "delegated": {"delegateId"},
                "review-pending": {"reviewerId", "independent", "mode", "degradation"},
                "review-approved": {"checks"},
                "review-rejected": {"checks"},
                "final-init-passed": {"command", "exitCode"},
            }
            allowed_fields = base_event_fields | target_event_fields.get(target, set())
            unexpected_fields = sorted(set(event) - allowed_fields)
            if unexpected_fields:
                errors.append(
                    f"task-status.json evidence {index} has unexpected fields: "
                    + ", ".join(unexpected_fields)
                )
            if event.get("sequence") != index:
                errors.append(f"task-status.json evidence sequence {index} is invalid")
            if event.get("from") != previous:
                errors.append(f"task-status.json evidence chain breaks at sequence {index}")
            event_branch = event.get("branch")
            if event_branch != branch:
                errors.append(f"task-status.json evidence branch {index} does not match task branch")
            if replayed_branch is None and target == "initialized":
                replayed_branch = event_branch
            if event_branch in TRANSITIONS and target not in TRANSITIONS[event_branch].get(previous, set()):
                errors.append(f"task-status.json evidence transition {index} is invalid")
            if actor_role != TARGET_ROLES.get(target):
                errors.append(f"task-status.json evidence actor role {index} is invalid")
            actor_was_assigned = (
                nonempty_string(actor_id)
                and actor_role in replayed_actors
                and actor_id in replayed_actors[actor_role]
            )
            if not nonempty_string(actor_id) or not nonempty_string(event.get("summary")):
                errors.append(f"task-status.json evidence actor/summary {index} is incomplete")

            timestamp = valid_timestamp(event.get("timestamp"))
            if timestamp is None:
                errors.append(f"task-status.json evidence timestamp {index} is invalid")
            elif previous_timestamp is not None and timestamp < previous_timestamp:
                errors.append(f"task-status.json evidence timestamps are out of order at sequence {index}")
            else:
                previous_timestamp = timestamp

            if target == "initialized":
                if not nonempty_string(event.get("task")):
                    errors.append("initialized evidence requires task")
                else:
                    replayed_task = event["task"]
                if (
                    not nonempty_string(event.get("command"))
                    or type(event.get("exitCode")) is not int
                    or event.get("exitCode") != 0
                ):
                    errors.append("initialized evidence requires command and exitCode=0")
                else:
                    replayed_validation["initialInitPassed"] = True
                    replayed_validation["initialInitCommand"] = event["command"]
            elif target == "analyzed":
                if event.get("classification") not in CLASSIFICATIONS:
                    errors.append("analyzed evidence requires classification")
                else:
                    replayed_classification = event["classification"]
                if not nonempty_string(event.get("capabilityTier")):
                    errors.append("analyzed evidence requires capabilityTier")
                else:
                    replayed_capability_tier = event["capabilityTier"]
                if not nonempty_string(event.get("selectedModel")):
                    errors.append("analyzed evidence requires selectedModel")
                else:
                    replayed_selected_model = event["selectedModel"]
                if previous == "review-rejected":
                    replayed_review = {
                        "approved": None,
                        "reviewerId": None,
                        "independent": None,
                        "mode": None,
                        "checks": [],
                    }
            elif target == "delegated":
                delegate_id = event.get("delegateId")
                if not nonempty_string(delegate_id):
                    errors.append("delegated evidence requires delegateId")
                else:
                    append_unique(replayed_actors["implementer"], delegate_id)
                if previous == "review-rejected":
                    replayed_review = {
                        "approved": None,
                        "reviewerId": None,
                        "independent": None,
                        "mode": None,
                        "checks": [],
                    }
            elif target in {"implemented", "tested"} and not actor_was_assigned:
                errors.append(f"{target} evidence actorId {index} was not delegated as implementer")
            elif target == "review-pending":
                reviewer_id = event.get("reviewerId")
                if not nonempty_string(reviewer_id):
                    errors.append("review-pending evidence requires reviewerId")
                else:
                    append_unique(replayed_actors["reviewer"], reviewer_id)
                delivery_ids = set(replayed_actors["leader"] + replayed_actors["implementer"])
                expected_independent = nonempty_string(reviewer_id) and reviewer_id not in delivery_ids
                expected_mode = "independent-review" if expected_independent else "review-pass"
                if event.get("independent") is not expected_independent:
                    errors.append("review-pending evidence independence is inconsistent with actor identities")
                if event.get("mode") != expected_mode:
                    errors.append("review-pending evidence mode is inconsistent with reviewer isolation")
                degradation = event.get("degradation")
                if expected_independent:
                    if "degradation" in event:
                        errors.append("independent review evidence must not record an isolation degradation")
                    replayed_review_isolations = []
                elif not nonempty_string(degradation) or not degradation.startswith("review-isolation:"):
                    errors.append("review-pass evidence requires a review-isolation degradation")
                else:
                    replayed_review_isolations = [degradation]
                replayed_review = {
                    "approved": None,
                    "reviewerId": reviewer_id,
                    "independent": expected_independent,
                    "mode": expected_mode,
                    "checks": [],
                }
            elif target in {"review-approved", "review-rejected"}:
                if actor_id != replayed_review.get("reviewerId"):
                    errors.append(f"reviewer event actorId {index} does not match assigned reviewerId")
                checks = event.get("checks")
                if (
                    not isinstance(checks, list)
                    or not all(check in set().union(*REQUIRED_REVIEW_CHECKS.values()) for check in checks)
                    or len(checks) != len(set(checks))
                ):
                    errors.append(f"reviewer event checks {index} are invalid")
                    checks = []
                if target == "review-approved" and branch in REQUIRED_REVIEW_CHECKS:
                    missing = REQUIRED_REVIEW_CHECKS[branch] - set(checks)
                    if missing:
                        errors.append("workflow review is missing branch-specific checks")
                if isinstance(checks, list) and checks != sorted(set(checks)):
                    errors.append(f"reviewer event checks {index} must be sorted and unique")
                replayed_review["approved"] = target == "review-approved"
                replayed_review["checks"] = checks
            elif target == "final-init-passed":
                if (
                    not nonempty_string(event.get("command"))
                    or type(event.get("exitCode")) is not int
                    or event.get("exitCode") != 0
                ):
                    errors.append("final-init-passed evidence requires command and exitCode=0")
                else:
                    replayed_validation["finalInitPassed"] = True
                    replayed_validation["finalInitCommand"] = event["command"]

            if nonempty_string(actor_id) and actor_role in replayed_actors:
                append_unique(replayed_actors[actor_role], actor_id)

            previous = target
        if evidence and phase != previous:
            errors.append("task-status.json phase does not match the evidence chain")
        if not evidence and phase != "uninitialized":
            errors.append("task-status.json non-initial phase requires evidence")

    if branch != replayed_branch:
        errors.append("task-status.json branch does not match initialized evidence")
    if state.get("task") != replayed_task:
        errors.append("task-status.json task does not match initialized evidence")
    if state.get("classification") != replayed_classification:
        errors.append("task-status.json classification does not match analyzed evidence")
    if state.get("capabilityTier") != replayed_capability_tier:
        errors.append("task-status.json capabilityTier does not match analyzed evidence")
    if state.get("selectedModel") != replayed_selected_model:
        errors.append("task-status.json selectedModel does not match analyzed evidence")
    if isinstance(actors, dict) and actors != replayed_actors:
        errors.append("task-status.json actors do not match evidence assignments")

    validation = state.get("validation")
    if not isinstance(validation, dict):
        errors.append("task-status.json validation must be an object")
    elif validation != replayed_validation:
        errors.append("task-status.json validation does not match init evidence")

    if phase not in {"uninitialized", "initialized"}:
        for field in ("task", "capabilityTier", "selectedModel"):
            if not nonempty_string(state.get(field)):
                errors.append(f"analyzed workflow requires {field}")
        if state.get("classification") not in CLASSIFICATIONS:
            errors.append("analyzed workflow requires classification")

    review = state.get("review")
    degraded = state.get("degradedCapabilities")
    actual_review_isolations = (
        [
            item
            for item in degraded
            if isinstance(item, str) and item.startswith("review-isolation:")
        ]
        if isinstance(degraded, list)
        else []
    )
    if not isinstance(review, dict):
        errors.append("task-status.json review must be an object")
    else:
        if review != replayed_review:
            errors.append("task-status.json review does not match reviewer evidence")
        reviewer_id = review.get("reviewerId")
        if reviewer_id is not None and (
            not nonempty_string(reviewer_id)
            or not isinstance(actors, dict)
            or reviewer_id not in actors.get("reviewer", [])
        ):
            errors.append("task-status.json reviewerId is not registered as a reviewer actor")
        if review.get("independent") is True:
            delivery_ids = set()
            if isinstance(actors, dict):
                delivery_ids.update(actors.get("leader", []))
                delivery_ids.update(actors.get("implementer", []))
            if reviewer_id in delivery_ids:
                errors.append("independent review requires a reviewer identity separate from delivery actors")
            if review.get("mode") != "independent-review":
                errors.append("independent review requires independent-review mode")
            if actual_review_isolations:
                errors.append("independent review must not have a review-isolation degradation")
        elif review.get("mode") == "review-pass":
            delivery_ids = set()
            if isinstance(actors, dict):
                delivery_ids.update(actors.get("leader", []))
                delivery_ids.update(actors.get("implementer", []))
            if reviewer_id not in delivery_ids:
                errors.append("review-pass requires a reviewer identity shared with a delivery actor")
            if not actual_review_isolations:
                errors.append("review-pass requires a coherent review-isolation degradation")

    if isinstance(degraded, list):
        if degraded != replayed_review_isolations:
            errors.append("task-status.json degradedCapabilities do not match reviewer evidence")

    if isinstance(review, dict) and phase in {"review-approved", "final-init-passed", "done"}:
        if review.get("approved") is not True:
            errors.append("workflow requires review.approved=true")
        checks = review.get("checks")
        required_checks = REQUIRED_REVIEW_CHECKS.get(branch, set())
        if not isinstance(checks, list) or not required_checks.issubset(set(checks)):
            errors.append("workflow review is missing branch-specific checks")
    if phase in {"final-init-passed", "done"}:
        if not isinstance(validation, dict) or validation.get("finalInitPassed") is not True:
            errors.append("workflow requires validation.finalInitPassed=true")
        elif not nonempty_string(validation.get("finalInitCommand")):
            errors.append("workflow requires a final init command")
    return errors


def checkpoint_values(path: Path) -> dict[str, Any]:
    problem = regular_file_error(path)
    if problem:
        raise WorkflowError(problem)
    values: dict[str, Any] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if ":" not in line or line.startswith(" "):
            continue
        key, raw = line.split(":", 1)
        raw = raw.strip()
        try:
            values[key] = json.loads(raw)
        except json.JSONDecodeError:
            values[key] = raw
    return values


def require_current_checkpoint(
    state: dict[str, Any],
    path: Path,
    target: str,
    actor_role: str,
    actor_id: str,
) -> None:
    values = checkpoint_values(path)
    expected_trigger = "before-delegation" if target == "delegated" else "before-phase-change"
    if values.get("trigger") != expected_trigger:
        raise WorkflowError(f"checkpoint trigger must be {expected_trigger} before {target}")
    if values.get("phase") != state["phase"] or values.get("next_phase") != target:
        raise WorkflowError("checkpoint phase does not match the requested transition")
    if values.get("state_sequence") != len(state["evidence"]):
        raise WorkflowError("checkpoint is stale for the current evidence sequence")
    if values.get("actor_role") != actor_role or values.get("actor_id") != actor_id:
        raise WorkflowError("checkpoint actor does not match the requested transition")


def append_actor(state: dict[str, Any], role: str, identity: str) -> None:
    identities = state["actors"][role]
    if identity not in identities:
        identities.append(identity)


def transition(state: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    errors = state_errors(state)
    if errors:
        raise WorkflowError("; ".join(errors))
    target = args.to
    expected_role = TARGET_ROLES[target]
    if args.actor_role != expected_role:
        raise WorkflowError(f"transition to {target} requires actor role {expected_role}")
    if not nonempty_string(args.actor_id) or not nonempty_string(args.evidence):
        raise WorkflowError("actor identity and evidence are required")

    current = state["phase"]
    branch = args.branch if current == "uninitialized" else state["branch"]
    if branch not in BRANCHES:
        raise WorkflowError("a valid branch is required for initialization")
    if target not in TRANSITIONS[branch].get(current, set()):
        raise WorkflowError(f"invalid {branch} transition: {current} -> {target}")
    if current != "uninitialized":
        require_current_checkpoint(state, args.checkpoint, target, args.actor_role, args.actor_id)

    if target == "initialized":
        if not nonempty_string(args.task):
            raise WorkflowError("initialization requires --task")
        if args.exit_code != 0 or not nonempty_string(args.command):
            raise WorkflowError("initialization requires a successful explicit init command")
        state["task"] = args.task.strip()
        state["branch"] = branch
        state["validation"]["initialInitPassed"] = True
        state["validation"]["initialInitCommand"] = args.command.strip()
    elif target == "analyzed":
        if args.classification not in CLASSIFICATIONS:
            raise WorkflowError("analysis requires --classification")
        if not nonempty_string(args.capability_tier) or not nonempty_string(args.selected_model):
            raise WorkflowError("analysis requires separate capability tier and selected model")
        state["classification"] = args.classification
        state["capabilityTier"] = args.capability_tier.strip()
        state["selectedModel"] = args.selected_model.strip()
        if current == "review-rejected":
            state["review"].update(
                {"approved": None, "reviewerId": None, "independent": None, "mode": None, "checks": []}
            )
    elif target == "delegated":
        if not nonempty_string(args.delegate_id):
            raise WorkflowError("delegation requires --delegate-id")
        append_actor(state, "implementer", args.delegate_id.strip())
        if current == "review-rejected":
            state["review"].update(
                {"approved": None, "reviewerId": None, "independent": None, "mode": None, "checks": []}
            )
    elif target in {"implemented", "tested"}:
        if args.actor_id not in state["actors"]["implementer"]:
            raise WorkflowError("implementer identity was not delegated")
    elif target == "review-pending":
        if not nonempty_string(args.reviewer_id):
            raise WorkflowError("review request requires --reviewer-id")
        reviewer_id = args.reviewer_id.strip()
        prior_delivery_ids = set(state["actors"]["leader"] + state["actors"]["implementer"])
        independent = reviewer_id not in prior_delivery_ids
        if not independent and not nonempty_string(args.degraded_review):
            raise WorkflowError("shared reviewer identity requires --degraded-review")
        append_actor(state, "reviewer", reviewer_id)
        state["degradedCapabilities"] = [
            value
            for value in state["degradedCapabilities"]
            if not value.startswith("review-isolation:")
        ]
        state["review"].update(
            {
                "approved": None,
                "reviewerId": reviewer_id,
                "independent": independent,
                "mode": "independent-review" if independent else "review-pass",
                "checks": [],
            }
        )
        if not independent:
            degradation = f"review-isolation:{args.degraded_review.strip()}"
            if degradation not in state["degradedCapabilities"]:
                state["degradedCapabilities"].append(degradation)
    elif target in {"review-approved", "review-rejected"}:
        if args.actor_id != state["review"].get("reviewerId"):
            raise WorkflowError("review result must come from the assigned reviewer identity")
        checks = sorted(set(args.review_check or []))
        if target == "review-approved":
            missing = REQUIRED_REVIEW_CHECKS[branch] - set(checks)
            if missing:
                raise WorkflowError("review approval is missing checks: " + ", ".join(sorted(missing)))
        state["review"]["approved"] = target == "review-approved"
        state["review"]["checks"] = checks
    elif target == "final-init-passed":
        if state["review"].get("approved") is not True:
            raise WorkflowError("final init requires reviewer approval")
        if args.exit_code != 0 or not nonempty_string(args.command):
            raise WorkflowError("final validation requires a successful explicit init command")
        state["validation"]["finalInitPassed"] = True
        state["validation"]["finalInitCommand"] = args.command.strip()
    elif target == "done":
        if state["review"].get("approved") is not True or state["validation"].get("finalInitPassed") is not True:
            raise WorkflowError("done requires reviewer approval and final init")

    append_actor(state, args.actor_role, args.actor_id.strip())
    state["phase"] = target
    state["status"] = "done" if target == "done" else "in-progress"
    event: dict[str, Any] = {
        "sequence": len(state["evidence"]) + 1,
        "timestamp": utc_now(),
        "branch": branch,
        "from": current,
        "to": target,
        "actorRole": args.actor_role,
        "actorId": args.actor_id.strip(),
        "summary": args.evidence.strip(),
    }
    if target == "initialized":
        event.update(
            {
                "task": args.task.strip(),
                "command": args.command.strip(),
                "exitCode": args.exit_code,
            }
        )
    elif target == "analyzed":
        event.update(
            {
                "classification": args.classification,
                "capabilityTier": args.capability_tier.strip(),
                "selectedModel": args.selected_model.strip(),
            }
        )
    elif target == "delegated":
        event["delegateId"] = args.delegate_id.strip()
    elif target == "review-pending":
        event.update(
            {
                "reviewerId": reviewer_id,
                "independent": independent,
                "mode": "independent-review" if independent else "review-pass",
            }
        )
        if not independent:
            event["degradation"] = degradation
    elif target in {"review-approved", "review-rejected"}:
        event["checks"] = checks
    elif target == "final-init-passed":
        event.update({"command": args.command.strip(), "exitCode": args.exit_code})
    state["evidence"].append(event)

    errors = state_errors(state)
    if errors:
        raise WorkflowError("; ".join(errors))
    return state


def quote(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def write_checkpoint(state: dict[str, Any], args: argparse.Namespace) -> None:
    errors = state_errors(state)
    if errors:
        raise WorkflowError("; ".join(errors))
    if not nonempty_string(args.actor_id):
        raise WorkflowError("checkpoint requires an actor identity")
    if args.trigger in {"before-phase-change", "before-delegation"}:
        if not args.next_phase:
            raise WorkflowError("phase/delegation checkpoint requires --next-phase")
        branch = state.get("branch")
        if branch not in TRANSITIONS or args.next_phase not in TRANSITIONS[branch].get(state["phase"], set()):
            raise WorkflowError("checkpoint next phase is not a valid transition")
        if args.trigger == "before-delegation" and args.next_phase != "delegated":
            raise WorkflowError("before-delegation checkpoint must target delegated")
        if args.trigger == "before-phase-change" and args.next_phase == "delegated":
            raise WorkflowError("use before-delegation for a delegated transition")
    content = "\n".join(
        [
            f"objective: {quote(args.objective or state.get('task') or '')}",
            f"trigger: {quote(args.trigger)}",
            f"phase: {quote(state['phase'])}",
            f"next_phase: {quote(args.next_phase)}",
            f"state_sequence: {len(state['evidence'])}",
            f"actor_role: {quote(args.actor_role)}",
            f"actor_id: {quote(args.actor_id)}",
            f"decisions: {quote(args.decision or [])}",
            f"files: {quote(args.file or [])}",
            f"tests: {quote(args.test or [])}",
            f"blockers: {quote(args.blocker or [])}",
            f"next_steps: {quote(args.next_step or [])}",
            "",
        ]
    )
    write_text_atomic(args.checkpoint, content)


def add_common_state_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--state",
        type=Path,
        default=Path(".harness/task-status.json"),
        help="Portable workflow state file.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)

    check_parser = subparsers.add_parser("check", help="Validate the current state without writing.")
    add_common_state_argument(check_parser)

    transition_parser = subparsers.add_parser("transition", help="Record one guarded phase transition.")
    add_common_state_argument(transition_parser)
    transition_parser.add_argument("--checkpoint", type=Path, default=Path(".harness/context/task-context.toon"))
    transition_parser.add_argument("--to", required=True, choices=tuple(TARGET_ROLES))
    transition_parser.add_argument("--actor-role", required=True, choices=ROLES)
    transition_parser.add_argument("--actor-id", required=True)
    transition_parser.add_argument("--evidence", required=True)
    transition_parser.add_argument("--task")
    transition_parser.add_argument("--branch", choices=BRANCHES)
    transition_parser.add_argument("--classification", choices=CLASSIFICATIONS)
    transition_parser.add_argument("--capability-tier")
    transition_parser.add_argument("--selected-model")
    transition_parser.add_argument("--delegate-id")
    transition_parser.add_argument("--reviewer-id")
    transition_parser.add_argument("--degraded-review")
    transition_parser.add_argument("--review-check", action="append", choices=sorted(set().union(*REQUIRED_REVIEW_CHECKS.values())))
    transition_parser.add_argument("--command")
    transition_parser.add_argument("--exit-code", type=int)

    checkpoint_parser = subparsers.add_parser("checkpoint", help="Write an observable continuity checkpoint.")
    add_common_state_argument(checkpoint_parser)
    checkpoint_parser.add_argument("--checkpoint", type=Path, default=Path(".harness/context/task-context.toon"))
    checkpoint_parser.add_argument("--trigger", required=True, choices=CHECKPOINT_TRIGGERS)
    checkpoint_parser.add_argument("--next-phase", choices=tuple(TARGET_ROLES))
    checkpoint_parser.add_argument("--actor-role", required=True, choices=ROLES)
    checkpoint_parser.add_argument("--actor-id", required=True)
    checkpoint_parser.add_argument("--objective")
    checkpoint_parser.add_argument("--decision", action="append")
    checkpoint_parser.add_argument("--file", action="append")
    checkpoint_parser.add_argument("--test", action="append")
    checkpoint_parser.add_argument("--blocker", action="append")
    checkpoint_parser.add_argument("--next-step", action="append")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        state = load_state(args.state)
        if args.action == "check":
            errors = state_errors(state)
            if errors:
                for error in errors:
                    print(f"error: {error}", file=sys.stderr)
                return 1
            print("custom-harness state: valid")
            return 0
        if args.action == "checkpoint":
            write_checkpoint(state, args)
            print(f"checkpoint recorded: {args.trigger}")
            return 0
        updated = transition(state, args)
        write_state(args.state, updated)
        print(f"transition recorded: {updated['evidence'][-1]['from']} -> {updated['phase']}")
        return 0
    except (OSError, UnicodeDecodeError, WorkflowError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
