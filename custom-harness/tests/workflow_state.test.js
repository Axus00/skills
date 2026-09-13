'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const WORKFLOW = require('../scripts/workflow_state.js');

let root;
let statePath;
let checkpointPath;

function silenced(callback) {
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return callback();
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}

function call(action, ...args) {
  return silenced(() => WORKFLOW.main([action, '--state', statePath, ...args]));
}

function transition(target, role, identity, ...extra) {
  return call(
    'transition',
    '--checkpoint',
    checkpointPath,
    '--to',
    target,
    '--actor-role',
    role,
    '--actor-id',
    identity,
    '--evidence',
    `evidence for ${target}`,
    ...extra,
  );
}

function checkpoint(target, role, identity) {
  const trigger = target === 'delegated' ? 'before-delegation' : 'before-phase-change';
  return call(
    'checkpoint',
    '--checkpoint',
    checkpointPath,
    '--trigger',
    trigger,
    '--next-phase',
    target,
    '--actor-role',
    role,
    '--actor-id',
    identity,
    '--decision',
    `advance to ${target}`,
    '--next-step',
    target,
  );
}

function initialize(branch) {
  assert.equal(
    transition(
      'initialized',
      'dispatcher',
      'dispatcher-1',
      '--task',
      'Test task',
      '--branch',
      branch,
      '--command',
      './init.sh',
      '--exit-code',
      '0',
    ),
    0,
  );
}

function analyze() {
  assert.equal(checkpoint('analyzed', 'leader', 'leader-1'), 0);
  assert.equal(
    transition(
      'analyzed',
      'leader',
      'leader-1',
      '--classification',
      'large',
      '--capability-tier',
      'strongest-suitable',
      '--selected-model',
      'runtime-model',
    ),
    0,
  );
}

function requestReview(reviewer = 'reviewer-1', ...extra) {
  assert.equal(checkpoint('review-pending', 'leader', 'leader-1'), 0);
  return transition('review-pending', 'leader', 'leader-1', '--reviewer-id', reviewer, ...extra);
}

function approve(branch, reviewer = 'reviewer-1') {
  assert.equal(checkpoint('review-approved', 'reviewer', reviewer), 0);
  const checks = [];
  for (const check of [...WORKFLOW.REQUIRED_REVIEW_CHECKS[branch]].sort()) {
    checks.push('--review-check', check);
  }
  assert.equal(transition('review-approved', 'reviewer', reviewer, ...checks), 0);
}

function finish() {
  assert.equal(checkpoint('final-init-passed', 'leader', 'leader-1'), 0);
  assert.equal(
    transition('final-init-passed', 'leader', 'leader-1', '--command', './init.sh', '--exit-code', '0'),
    0,
  );
  assert.equal(checkpoint('done', 'leader', 'leader-1'), 0);
  assert.equal(transition('done', 'leader', 'leader-1'), 0);
}

function loadState() {
  return WORKFLOW.loadState(statePath);
}

function completedReviewState(reviewer = 'reviewer-1', degradedReason = null) {
  const extra = degradedReason ? ['--degraded-review', degradedReason] : [];
  initialize('review');
  analyze();
  assert.equal(requestReview(reviewer, ...extra), 0);
  approve('review', reviewer);
  finish();
  return loadState();
}

function runDeliveryBranch(branch) {
  initialize(branch);
  analyze();
  assert.equal(checkpoint('delegated', 'leader', 'leader-1'), 0);
  assert.equal(transition('delegated', 'leader', 'leader-1', '--delegate-id', 'implementer-1'), 0);
  assert.equal(checkpoint('implemented', 'implementer', 'implementer-1'), 0);
  assert.equal(transition('implemented', 'implementer', 'implementer-1'), 0);
  assert.equal(checkpoint('tested', 'implementer', 'implementer-1'), 0);
  assert.equal(transition('tested', 'implementer', 'implementer-1'), 0);
  assert.equal(requestReview(), 0);
  approve(branch);
  finish();
  return loadState();
}

function assertInvalidState(state, expectedError) {
  const errors = WORKFLOW.stateErrors(state);
  assert.ok(
    errors.some((error) => error.includes(expectedError)),
    `expected ${JSON.stringify(expectedError)} in ${JSON.stringify(errors)}`,
  );
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  assert.equal(call('check'), 1);
}

function event(state, target) {
  return state.evidence.find((item) => item.to === target);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-state-'));
  statePath = path.join(root, '.harness/task-status.json');
  checkpointPath = path.join(root, '.harness/context/task-context.toon');
  fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(WORKFLOW.defaultState(), null, 2)}\n`, 'utf8');
  fs.writeFileSync(checkpointPath, 'objective: ""\n', 'utf8');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('test_review_branch_end_to_end_skips_implementation_and_distribution', () => {
  initialize('review');
  analyze();
  assert.equal(requestReview(), 0);
  approve('review');
  finish();

  const state = loadState();
  assert.equal(state.phase, 'done');
  assert.deepEqual(state.actors.implementer, []);
  assert.ok(!state.review.checks.includes('distribution'));
  assert.deepEqual(WORKFLOW.stateErrors(state), []);
});

test('test_install_adapt_branch_end_to_end', () => {
  const state = runDeliveryBranch('install-adapt');

  assert.equal(state.status, 'done');
  assert.ok(!state.review.checks.includes('distribution'));
  assert.deepEqual(WORKFLOW.stateErrors(state), []);
});

test('test_package_branch_end_to_end_requires_distribution', () => {
  const state = runDeliveryBranch('package');

  assert.ok(state.review.checks.includes('distribution'));
  assert.deepEqual(WORKFLOW.stateErrors(state), []);
});

test('test_analysis_is_rejected_before_successful_init', () => {
  const result = transition(
    'analyzed',
    'leader',
    'leader-1',
    '--classification',
    'small',
    '--capability-tier',
    'fast',
    '--selected-model',
    'runtime-model',
  );

  assert.equal(result, 2);
  assert.equal(loadState().phase, 'uninitialized');
});

test('test_failed_initial_init_is_rejected', () => {
  const result = transition(
    'initialized',
    'dispatcher',
    'dispatcher-1',
    '--task',
    'Test task',
    '--branch',
    'review',
    '--command',
    './init.sh',
    '--exit-code',
    '1',
  );

  assert.equal(result, 2);
  assert.equal(loadState().validation.initialInitPassed, false);
});

test('test_post_init_transition_requires_fresh_checkpoint', () => {
  initialize('review');

  const result = transition(
    'analyzed',
    'leader',
    'leader-1',
    '--classification',
    'small',
    '--capability-tier',
    'fast',
    '--selected-model',
    'runtime-model',
  );

  assert.equal(result, 2);
  assert.equal(loadState().phase, 'initialized');
});

test('test_checkpoint_actor_must_match_transition_actor', () => {
  initialize('review');
  assert.equal(checkpoint('analyzed', 'leader', 'leader-1'), 0);

  const result = transition(
    'analyzed',
    'leader',
    'leader-2',
    '--classification',
    'small',
    '--capability-tier',
    'fast',
    '--selected-model',
    'runtime-model',
  );

  assert.equal(result, 2);
  assert.equal(loadState().phase, 'initialized');
});

test('test_analysis_requires_capability_tier_and_selected_model', () => {
  initialize('review');
  assert.equal(checkpoint('analyzed', 'leader', 'leader-1'), 0);

  const result = transition(
    'analyzed',
    'leader',
    'leader-1',
    '--classification',
    'small',
    '--capability-tier',
    'fast',
  );

  assert.equal(result, 2);
});

test('test_shared_reviewer_identity_requires_explicit_degradation', () => {
  initialize('review');
  analyze();
  assert.equal(requestReview('leader-1'), 2);
  assert.equal(requestReview('leader-1', '--degraded-review', 'cursor-no-native-isolation'), 0);

  const state = loadState();
  assert.equal(state.review.independent, false);
  assert.equal(state.review.mode, 'review-pass');
  assert.ok(state.degradedCapabilities.includes('review-isolation:cursor-no-native-isolation'));
});

test('test_review_approval_requires_branch_specific_checks', () => {
  initialize('package');
  analyze();
  assert.equal(checkpoint('delegated', 'leader', 'leader-1'), 0);
  assert.equal(transition('delegated', 'leader', 'leader-1', '--delegate-id', 'implementer-1'), 0);
  assert.equal(checkpoint('implemented', 'implementer', 'implementer-1'), 0);
  assert.equal(transition('implemented', 'implementer', 'implementer-1'), 0);
  assert.equal(checkpoint('tested', 'implementer', 'implementer-1'), 0);
  assert.equal(transition('tested', 'implementer', 'implementer-1'), 0);
  assert.equal(requestReview(), 0);
  assert.equal(checkpoint('review-approved', 'reviewer', 'reviewer-1'), 0);
  const checks = [];
  for (const check of WORKFLOW.REQUIRED_REVIEW_CHECKS.package.filter((c) => c !== 'distribution').sort()) {
    checks.push('--review-check', check);
  }

  const result = transition('review-approved', 'reviewer', 'reviewer-1', ...checks);

  assert.equal(result, 2);
  assert.equal(loadState().phase, 'review-pending');
});

test('test_done_is_rejected_before_final_init', () => {
  initialize('review');
  analyze();
  assert.equal(requestReview(), 0);
  approve('review');
  const result = transition('done', 'leader', 'leader-1');

  assert.equal(result, 2);
  assert.equal(loadState().phase, 'review-approved');
});

test('test_rejected_delivery_review_returns_to_delegated', () => {
  initialize('install-adapt');
  analyze();
  assert.equal(checkpoint('delegated', 'leader', 'leader-1'), 0);
  assert.equal(transition('delegated', 'leader', 'leader-1', '--delegate-id', 'implementer-1'), 0);
  assert.equal(checkpoint('implemented', 'implementer', 'implementer-1'), 0);
  assert.equal(transition('implemented', 'implementer', 'implementer-1'), 0);
  assert.equal(checkpoint('tested', 'implementer', 'implementer-1'), 0);
  assert.equal(transition('tested', 'implementer', 'implementer-1'), 0);
  assert.equal(requestReview(), 0);
  assert.equal(checkpoint('review-rejected', 'reviewer', 'reviewer-1'), 0);
  assert.equal(transition('review-rejected', 'reviewer', 'reviewer-1'), 0);
  assert.equal(checkpoint('delegated', 'leader', 'leader-1'), 0);

  const result = transition('delegated', 'leader', 'leader-1', '--delegate-id', 'implementer-2');

  assert.equal(result, 0);
  assert.equal(loadState().phase, 'delegated');
});

test('test_persisted_event_branch_must_match_task_branch', () => {
  const state = completedReviewState();
  event(state, 'analyzed').branch = 'package';

  assertInvalidState(state, 'evidence branch 2 does not match task branch');
});

test('test_persisted_actor_identity_must_match_role_assignments', () => {
  const state = completedReviewState();
  state.actors.leader = [];

  assertInvalidState(state, 'actors do not match evidence assignments');
});

test('test_persisted_implementer_event_requires_prior_delegation', () => {
  const state = runDeliveryBranch('install-adapt');
  event(state, 'delegated').delegateId = 'implementer-2';
  state.actors.implementer = ['implementer-2', 'implementer-1'];

  assertInvalidState(state, 'was not delegated as implementer');
});

test('test_persisted_reviewer_event_must_use_assigned_reviewer', () => {
  const state = completedReviewState();
  event(state, 'review-approved').actorId = 'reviewer-2';
  state.actors.reviewer.push('reviewer-2');

  assertInvalidState(state, 'does not match assigned reviewerId');
});

test('test_persisted_reviewer_id_must_be_registered', () => {
  const state = completedReviewState();
  state.review.reviewerId = 'reviewer-2';

  assertInvalidState(state, 'reviewerId is not registered');
});

test('test_persisted_independent_review_requires_separate_identity', () => {
  const state = completedReviewState();
  Object.assign(event(state, 'review-pending'), {
    reviewerId: 'leader-1',
    independent: true,
    mode: 'independent-review',
  });
  event(state, 'review-approved').actorId = 'leader-1';
  state.actors.reviewer = ['leader-1'];
  Object.assign(state.review, { reviewerId: 'leader-1', independent: true, mode: 'independent-review' });

  assertInvalidState(state, 'requires a reviewer identity separate');
});

test('test_persisted_independent_review_rejects_isolation_degradation', () => {
  const state = completedReviewState();
  state.degradedCapabilities = ['review-isolation:forged'];

  assertInvalidState(state, 'must not have a review-isolation degradation');
});

test('test_persisted_review_pass_requires_shared_identity', () => {
  const state = completedReviewState();
  Object.assign(event(state, 'review-pending'), {
    independent: false,
    mode: 'review-pass',
    degradation: 'review-isolation:forged',
  });
  state.degradedCapabilities = ['review-isolation:forged'];
  Object.assign(state.review, { independent: false, mode: 'review-pass' });

  assertInvalidState(state, 'requires a reviewer identity shared');
});

test('test_persisted_review_pass_requires_degradation', () => {
  const state = completedReviewState('leader-1', 'cursor-no-native-isolation');
  delete event(state, 'review-pending').degradation;
  state.degradedCapabilities = [];

  assertInvalidState(state, 'requires a coherent review-isolation degradation');
});

test('test_persisted_timestamp_must_be_valid_utc', () => {
  const state = completedReviewState();
  state.evidence[0].timestamp = 'not-a-timestamp';

  assertInvalidState(state, 'evidence timestamp 1 is invalid');
});

test('test_persisted_timestamp_rejects_non_utc_offset', () => {
  const state = completedReviewState();
  state.evidence[0].timestamp = '2026-01-01T00:00:00+02:00';

  assertInvalidState(state, 'evidence timestamp 1 is invalid');
});

test('test_persisted_timestamps_must_be_ordered', () => {
  const state = completedReviewState();
  state.evidence[1].timestamp = '2000-01-01T00:00:00Z';

  assertInvalidState(state, 'evidence timestamps are out of order');
});

test('test_persisted_initialization_requires_command', () => {
  const state = completedReviewState();
  delete event(state, 'initialized').command;

  assertInvalidState(state, 'initialized evidence requires command and exitCode=0');
});

test('test_persisted_initialization_requires_zero_integer_exit_code', () => {
  const state = completedReviewState();
  event(state, 'initialized').exitCode = false;

  assertInvalidState(state, 'initialized evidence requires command and exitCode=0');
});

test('test_persisted_final_init_requires_command', () => {
  const state = completedReviewState();
  delete event(state, 'final-init-passed').command;

  assertInvalidState(state, 'final-init-passed evidence requires command and exitCode=0');
});

test('test_persisted_final_init_requires_zero_integer_exit_code', () => {
  const state = completedReviewState();
  event(state, 'final-init-passed').exitCode = 1;

  assertInvalidState(state, 'final-init-passed evidence requires command and exitCode=0');
});

test('test_persisted_analysis_fields_must_match_evidence', () => {
  const state = completedReviewState();
  state.selectedModel = 'forged-model';

  assertInvalidState(state, 'selectedModel does not match analyzed evidence');
});

test('test_persisted_evidence_rejects_fields_not_emitted_by_cli', () => {
  const state = completedReviewState();
  event(state, 'analyzed').command = 'untrusted-command';

  assertInvalidState(state, 'has unexpected fields');
});

test('test_persisted_dependencies_cannot_bypass_cli', () => {
  const state = completedReviewState();
  state.dependencies = ['forged-dependency'];

  assertInvalidState(state, 'dependencies cannot be mutated');
});

test('test_persisted_prototype_keys_are_rejected_without_crashing', () => {
  const base = completedReviewState();
  for (const forged of ['constructor', '__proto__', 'toString']) {
    const state = JSON.parse(JSON.stringify(base));
    event(state, 'analyzed').to = forged;
    assertInvalidState(state, 'evidence transition 2 is invalid');
  }
  const state = JSON.parse(JSON.stringify(base));
  state.branch = 'constructor';
  state.phase = 'done';
  for (const item of state.evidence) item.branch = 'constructor';
  assertInvalidState(state, 'branch is invalid');
});

test('test_persisted_timestamp_rejects_calendar_rollover', () => {
  const state = completedReviewState();
  state.evidence[0].timestamp = '2024-02-30T00:00:00Z';

  assertInvalidState(state, 'evidence timestamp 1 is invalid');
});

test('test_checkpoint_with_prototype_key_does_not_poison_values', () => {
  initialize('review');
  fs.writeFileSync(checkpointPath, '__proto__: {"trigger":"before-phase-change"}\ntrigger: "before-delegation"\n', 'utf8');
  const result = transition('analyzed', 'leader', 'leader-1', '--classification', 'small', '--capability-tier', 'fast', '--selected-model', 'm');
  assert.equal(result, 2);
  assert.equal(loadState().phase, 'initialized');
});

test('test_cli_rejects_unknown_action_and_invalid_choices_with_exit_2', () => {
  assert.equal(call('bogus'), 2);
  assert.equal(transition('nowhere', 'leader', 'leader-1'), 2);
  assert.equal(transition('initialized', 'dispatcher', 'd', '--exit-code', 'zero'), 2);
  assert.equal(silenced(() => WORKFLOW.main(['transition', '--help'])), 0);
  assert.equal(silenced(() => WORKFLOW.main([])), 2);
});

test('test_state_write_refuses_symlinked_state_file', () => {
  const real = path.join(root, 'real-state.json');
  fs.writeFileSync(real, `${JSON.stringify(WORKFLOW.defaultState(), null, 2)}\n`, 'utf8');
  fs.unlinkSync(statePath);
  fs.symlinkSync(real, statePath);

  assert.equal(
    transition('initialized', 'dispatcher', 'd', '--task', 't', '--branch', 'review', '--command', 'x', '--exit-code', '0'),
    2,
  );
  assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).phase, 'uninitialized');
});
