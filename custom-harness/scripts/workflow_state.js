#!/usr/bin/env node
'use strict';
/** Record and validate Custom Harness workflow state without executing commands. */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const SCHEMA_VERSION = 2;
const BRANCHES = ['review', 'install-adapt', 'package'];
const CLASSIFICATIONS = ['small', 'medium', 'large'];
const ROLES = ['dispatcher', 'leader', 'implementer', 'reviewer'];
const CHECKPOINT_TRIGGERS = [
  'before-phase-change',
  'before-delegation',
  'before-compaction',
  'before-handoff',
];

const DELIVERY_GRAPH = {
  uninitialized: ['initialized'],
  initialized: ['analyzed'],
  analyzed: ['delegated'],
  delegated: ['implemented'],
  implemented: ['tested'],
  tested: ['review-pending'],
  'review-pending': ['review-approved', 'review-rejected'],
  'review-rejected': ['delegated'],
  'review-approved': ['final-init-passed'],
  'final-init-passed': ['done'],
  done: [],
};

const TRANSITIONS = {
  review: {
    uninitialized: ['initialized'],
    initialized: ['analyzed'],
    analyzed: ['review-pending'],
    'review-pending': ['review-approved', 'review-rejected'],
    'review-rejected': ['analyzed'],
    'review-approved': ['final-init-passed'],
    'final-init-passed': ['done'],
    done: [],
  },
  'install-adapt': DELIVERY_GRAPH,
  package: DELIVERY_GRAPH,
};

const TARGET_ROLES = {
  initialized: 'dispatcher',
  analyzed: 'leader',
  delegated: 'leader',
  implemented: 'implementer',
  tested: 'implementer',
  'review-pending': 'leader',
  'review-approved': 'reviewer',
  'review-rejected': 'reviewer',
  'final-init-passed': 'leader',
  done: 'leader',
};

const REQUIRED_REVIEW_CHECKS = {
  review: ['requirements', 'scope', 'evidence', 'consumer-policy'],
  'install-adapt': [
    'requirements',
    'scope',
    'behavior',
    'tests',
    'security',
    'state-transitions',
    'adapter-conformance',
    'consumer-policy',
  ],
  package: [
    'requirements',
    'scope',
    'behavior',
    'tests',
    'security',
    'state-transitions',
    'adapter-conformance',
    'distribution',
    'consumer-policy',
  ],
};

const ALL_REVIEW_CHECKS = [...new Set(Object.values(REQUIRED_REVIEW_CHECKS).flat())].sort();

class WorkflowError extends Error {
  /** Raised when a requested state mutation violates the workflow contract. */
}

function utcNow() {
  return new Date().toISOString();
}

function defaultState() {
  const actors = {};
  for (const role of ROLES) actors[role] = [];
  return {
    schemaVersion: SCHEMA_VERSION,
    task: null,
    branch: null,
    classification: null,
    status: 'in-progress',
    phase: 'uninitialized',
    evidence: [],
    dependencies: [],
    capabilityTier: null,
    selectedModel: null,
    degradedCapabilities: [],
    actors,
    review: {
      approved: null,
      reviewerId: null,
      independent: null,
      mode: null,
      checks: [],
    },
    validation: {
      initialInitPassed: false,
      initialInitCommand: null,
      finalInitPassed: false,
      finalInitCommand: null,
    },
  };
}

/** Own-property lookup that ignores inherited keys such as `constructor` or `__proto__`. */
function own(table, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function nonemptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (typeof left === 'object') {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(
      (key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]),
    );
  }
  return false;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function allUniqueNonemptyStrings(values) {
  return values.every(nonemptyString) && new Set(values).size === values.length;
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function regularFileError(target, { allowMissing = false } = {}) {
  const stats = lstatOrNull(target);
  if (stats && stats.isSymbolicLink()) return `path is a symlink: ${target}`;
  if (!stats) return allowMissing ? null : `path does not exist: ${target}`;
  if (!stats.isFile()) return `path is not a regular file: ${target}`;
  if (stats.nlink > 1) return `path has multiple hard links: ${target}`;
  return null;
}

function loadState(statePath) {
  const problem = regularFileError(statePath);
  if (problem) throw new WorkflowError(problem);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    throw new WorkflowError(`invalid state file: ${error.message}`);
  }
  if (!isObject(value)) throw new WorkflowError('state must be a JSON object');
  return value;
}

function writeTextAtomic(target, content) {
  const problem = regularFileError(target, { allowMissing: true });
  if (problem) throw new WorkflowError(problem);
  const parent = path.dirname(target);
  const parentStats = lstatOrNull(parent);
  if (!parentStats || parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
    throw new WorkflowError(`parent must be a real directory: ${parent}`);
  }
  const temporary = path.join(parent, `.${path.basename(target)}.tmp`);
  if (lstatOrNull(temporary)) throw new WorkflowError(`temporary path is occupied: ${temporary}`);
  try {
    fs.writeFileSync(temporary, content, 'utf8');
    fs.renameSync(temporary, target);
  } finally {
    const leftover = lstatOrNull(temporary);
    if (leftover && !leftover.isSymbolicLink()) fs.unlinkSync(temporary);
  }
}

function writeState(statePath, state) {
  writeTextAtomic(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

const TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?)(Z|[+-]\d{2}:\d{2})$/;

/** Returns epoch milliseconds for a timezone-aware UTC timestamp, else null. */
function validTimestamp(value) {
  if (!nonemptyString(value)) return null;
  const match = value.match(TIMESTAMP_PATTERN);
  if (!match) return null;
  const offset = match[3];
  if (offset !== 'Z' && offset !== '+00:00' && offset !== '-00:00') return null;
  const parsed = Date.parse(`${match[1]}T${match[2]}Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== match[1]) return null;
  return parsed;
}

function appendUnique(values, value) {
  if (!values.includes(value)) values.push(value);
}

function emptyReview() {
  return { approved: null, reviewerId: null, independent: null, mode: null, checks: [] };
}

const BASE_EVENT_FIELDS = [
  'sequence',
  'timestamp',
  'branch',
  'from',
  'to',
  'actorRole',
  'actorId',
  'summary',
];

const TARGET_EVENT_FIELDS = {
  initialized: ['task', 'command', 'exitCode'],
  analyzed: ['classification', 'capabilityTier', 'selectedModel'],
  delegated: ['delegateId'],
  'review-pending': ['reviewerId', 'independent', 'mode', 'degradation'],
  'review-approved': ['checks'],
  'review-rejected': ['checks'],
  'final-init-passed': ['command', 'exitCode'],
};

function stateErrors(state) {
  if (!isObject(state)) return ['task-status.json must be an object'];

  const errors = [];
  const requiredFields = Object.keys(defaultState());
  const presentFields = Object.keys(state);
  for (const field of requiredFields.filter((name) => !presentFields.includes(name)).sort()) {
    errors.push(`task-status.json missing field: ${field}`);
  }
  for (const field of presentFields.filter((name) => !requiredFields.includes(name)).sort()) {
    errors.push(`task-status.json unexpected field: ${field}`);
  }
  if (errors.length) return errors;

  if (state.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`task-status.json schemaVersion must be ${SCHEMA_VERSION}`);
  }
  const branch = state.branch;
  const phase = state.phase;
  if (branch !== null && !BRANCHES.includes(branch)) {
    errors.push('task-status.json branch is invalid');
  }
  const validPhases = new Set(['uninitialized']);
  const branchGraph = own(TRANSITIONS, branch);
  if (branchGraph) {
    for (const name of Object.keys(branchGraph)) validPhases.add(name);
  }
  if (!validPhases.has(phase)) errors.push('task-status.json phase is invalid for its branch');
  const expectedStatus = phase === 'done' ? 'done' : 'in-progress';
  if (state.status !== expectedStatus) {
    errors.push(`task-status.json status must be ${expectedStatus} for phase ${phase}`);
  }
  if (state.task !== null && !nonemptyString(state.task)) {
    errors.push('task-status.json task must be a non-empty string or null');
  }
  if (state.classification !== null && !CLASSIFICATIONS.includes(state.classification)) {
    errors.push('task-status.json classification is invalid');
  }
  for (const field of ['evidence', 'dependencies', 'degradedCapabilities']) {
    const values = state[field];
    if (!Array.isArray(values)) {
      errors.push(`task-status.json ${field} must be an array`);
    } else if (field !== 'evidence' && !allUniqueNonemptyStrings(values)) {
      errors.push(`task-status.json ${field} must contain unique non-empty strings`);
    }
  }
  if (Array.isArray(state.dependencies) && state.dependencies.length) {
    errors.push('task-status.json dependencies cannot be mutated by the workflow engine');
  }
  for (const field of ['capabilityTier', 'selectedModel']) {
    if (state[field] !== null && !nonemptyString(state[field])) {
      errors.push(`task-status.json ${field} must be a non-empty string or null`);
    }
  }

  const actors = state.actors;
  if (!isObject(actors)) {
    errors.push('task-status.json actors must be an object');
  } else {
    const actorRoles = Object.keys(actors);
    if (actorRoles.length !== ROLES.length || !ROLES.every((role) => actorRoles.includes(role))) {
      errors.push('task-status.json actors must contain exactly the supported roles');
    }
    for (const role of ROLES) {
      const values = actors[role];
      if (!Array.isArray(values) || !allUniqueNonemptyStrings(values)) {
        errors.push(`task-status.json actors.${role} must be an array of unique identities`);
      }
    }
  }

  const evidence = state.evidence;
  let replayedBranch = null;
  let replayedTask = null;
  let replayedClassification = null;
  let replayedCapabilityTier = null;
  let replayedSelectedModel = null;
  const replayedActors = {};
  for (const role of ROLES) replayedActors[role] = [];
  let replayedReview = emptyReview();
  const replayedValidation = {
    initialInitPassed: false,
    initialInitCommand: null,
    finalInitPassed: false,
    finalInitCommand: null,
  };
  let replayedReviewIsolations = [];

  if (Array.isArray(evidence)) {
    let previous = 'uninitialized';
    let previousTimestamp = null;
    evidence.forEach((event, offset) => {
      const index = offset + 1;
      if (!isObject(event)) {
        errors.push(`task-status.json evidence[${offset}] must be an object`);
        return;
      }
      const target = event.to;
      const actorRole = event.actorRole;
      const actorId = event.actorId;
      const allowedFields = [...BASE_EVENT_FIELDS, ...(own(TARGET_EVENT_FIELDS, target) || [])];
      const unexpectedFields = Object.keys(event)
        .filter((field) => !allowedFields.includes(field))
        .sort();
      if (unexpectedFields.length) {
        errors.push(
          `task-status.json evidence ${index} has unexpected fields: ${unexpectedFields.join(', ')}`,
        );
      }
      if (event.sequence !== index) errors.push(`task-status.json evidence sequence ${index} is invalid`);
      if (event.from !== previous) errors.push(`task-status.json evidence chain breaks at sequence ${index}`);
      const eventBranch = event.branch;
      if (eventBranch !== branch) {
        errors.push(`task-status.json evidence branch ${index} does not match task branch`);
      }
      if (replayedBranch === null && target === 'initialized') replayedBranch = eventBranch;
      const eventGraph = own(TRANSITIONS, eventBranch);
      if (eventGraph && !(own(eventGraph, previous) || []).includes(target)) {
        errors.push(`task-status.json evidence transition ${index} is invalid`);
      }
      if (actorRole !== own(TARGET_ROLES, target)) {
        errors.push(`task-status.json evidence actor role ${index} is invalid`);
      }
      const actorWasAssigned =
        nonemptyString(actorId) &&
        Object.prototype.hasOwnProperty.call(replayedActors, actorRole) &&
        replayedActors[actorRole].includes(actorId);
      if (!nonemptyString(actorId) || !nonemptyString(event.summary)) {
        errors.push(`task-status.json evidence actor/summary ${index} is incomplete`);
      }

      const timestamp = validTimestamp(event.timestamp);
      if (timestamp === null) {
        errors.push(`task-status.json evidence timestamp ${index} is invalid`);
      } else if (previousTimestamp !== null && timestamp < previousTimestamp) {
        errors.push(`task-status.json evidence timestamps are out of order at sequence ${index}`);
      } else {
        previousTimestamp = timestamp;
      }

      if (target === 'initialized') {
        if (!nonemptyString(event.task)) {
          errors.push('initialized evidence requires task');
        } else {
          replayedTask = event.task;
        }
        if (!nonemptyString(event.command) || !isInteger(event.exitCode) || event.exitCode !== 0) {
          errors.push('initialized evidence requires command and exitCode=0');
        } else {
          replayedValidation.initialInitPassed = true;
          replayedValidation.initialInitCommand = event.command;
        }
      } else if (target === 'analyzed') {
        if (!CLASSIFICATIONS.includes(event.classification)) {
          errors.push('analyzed evidence requires classification');
        } else {
          replayedClassification = event.classification;
        }
        if (!nonemptyString(event.capabilityTier)) {
          errors.push('analyzed evidence requires capabilityTier');
        } else {
          replayedCapabilityTier = event.capabilityTier;
        }
        if (!nonemptyString(event.selectedModel)) {
          errors.push('analyzed evidence requires selectedModel');
        } else {
          replayedSelectedModel = event.selectedModel;
        }
        if (previous === 'review-rejected') replayedReview = emptyReview();
      } else if (target === 'delegated') {
        const delegateId = event.delegateId;
        if (!nonemptyString(delegateId)) {
          errors.push('delegated evidence requires delegateId');
        } else {
          appendUnique(replayedActors.implementer, delegateId);
        }
        if (previous === 'review-rejected') replayedReview = emptyReview();
      } else if ((target === 'implemented' || target === 'tested') && !actorWasAssigned) {
        errors.push(`${target} evidence actorId ${index} was not delegated as implementer`);
      } else if (target === 'review-pending') {
        const reviewerId = event.reviewerId;
        if (!nonemptyString(reviewerId)) {
          errors.push('review-pending evidence requires reviewerId');
        } else {
          appendUnique(replayedActors.reviewer, reviewerId);
        }
        const deliveryIds = new Set([...replayedActors.leader, ...replayedActors.implementer]);
        const expectedIndependent = nonemptyString(reviewerId) && !deliveryIds.has(reviewerId);
        const expectedMode = expectedIndependent ? 'independent-review' : 'review-pass';
        if (event.independent !== expectedIndependent) {
          errors.push('review-pending evidence independence is inconsistent with actor identities');
        }
        if (event.mode !== expectedMode) {
          errors.push('review-pending evidence mode is inconsistent with reviewer isolation');
        }
        const degradation = event.degradation;
        if (expectedIndependent) {
          if (Object.prototype.hasOwnProperty.call(event, 'degradation')) {
            errors.push('independent review evidence must not record an isolation degradation');
          }
          replayedReviewIsolations = [];
        } else if (!nonemptyString(degradation) || !degradation.startsWith('review-isolation:')) {
          errors.push('review-pass evidence requires a review-isolation degradation');
        } else {
          replayedReviewIsolations = [degradation];
        }
        replayedReview = {
          approved: null,
          reviewerId,
          independent: expectedIndependent,
          mode: expectedMode,
          checks: [],
        };
      } else if (target === 'review-approved' || target === 'review-rejected') {
        if (actorId !== replayedReview.reviewerId) {
          errors.push(`reviewer event actorId ${index} does not match assigned reviewerId`);
        }
        let checks = event.checks;
        if (
          !Array.isArray(checks) ||
          !checks.every((check) => ALL_REVIEW_CHECKS.includes(check)) ||
          new Set(checks).size !== checks.length
        ) {
          errors.push(`reviewer event checks ${index} are invalid`);
          checks = [];
        }
        const branchChecks = own(REQUIRED_REVIEW_CHECKS, branch);
        if (target === 'review-approved' && branchChecks) {
          const missing = branchChecks.filter((check) => !checks.includes(check));
          if (missing.length) errors.push('workflow review is missing branch-specific checks');
        }
        if (!deepEqual(checks, uniqueSorted(checks))) {
          errors.push(`reviewer event checks ${index} must be sorted and unique`);
        }
        replayedReview.approved = target === 'review-approved';
        replayedReview.checks = checks;
      } else if (target === 'final-init-passed') {
        if (!nonemptyString(event.command) || !isInteger(event.exitCode) || event.exitCode !== 0) {
          errors.push('final-init-passed evidence requires command and exitCode=0');
        } else {
          replayedValidation.finalInitPassed = true;
          replayedValidation.finalInitCommand = event.command;
        }
      }

      if (nonemptyString(actorId) && Object.prototype.hasOwnProperty.call(replayedActors, actorRole)) {
        appendUnique(replayedActors[actorRole], actorId);
      }

      previous = target;
    });
    if (evidence.length && phase !== previous) {
      errors.push('task-status.json phase does not match the evidence chain');
    }
    if (!evidence.length && phase !== 'uninitialized') {
      errors.push('task-status.json non-initial phase requires evidence');
    }
  }

  if (branch !== replayedBranch) errors.push('task-status.json branch does not match initialized evidence');
  if (state.task !== replayedTask) errors.push('task-status.json task does not match initialized evidence');
  if (state.classification !== replayedClassification) {
    errors.push('task-status.json classification does not match analyzed evidence');
  }
  if (state.capabilityTier !== replayedCapabilityTier) {
    errors.push('task-status.json capabilityTier does not match analyzed evidence');
  }
  if (state.selectedModel !== replayedSelectedModel) {
    errors.push('task-status.json selectedModel does not match analyzed evidence');
  }
  if (isObject(actors) && !deepEqual(actors, replayedActors)) {
    errors.push('task-status.json actors do not match evidence assignments');
  }

  const validation = state.validation;
  if (!isObject(validation)) {
    errors.push('task-status.json validation must be an object');
  } else if (!deepEqual(validation, replayedValidation)) {
    errors.push('task-status.json validation does not match init evidence');
  }

  if (phase !== 'uninitialized' && phase !== 'initialized') {
    for (const field of ['task', 'capabilityTier', 'selectedModel']) {
      if (!nonemptyString(state[field])) errors.push(`analyzed workflow requires ${field}`);
    }
    if (!CLASSIFICATIONS.includes(state.classification)) {
      errors.push('analyzed workflow requires classification');
    }
  }

  const review = state.review;
  const degraded = state.degradedCapabilities;
  const actualReviewIsolations = Array.isArray(degraded)
    ? degraded.filter((item) => typeof item === 'string' && item.startsWith('review-isolation:'))
    : [];
  if (!isObject(review)) {
    errors.push('task-status.json review must be an object');
  } else {
    if (!deepEqual(review, replayedReview)) {
      errors.push('task-status.json review does not match reviewer evidence');
    }
    const reviewerId = review.reviewerId;
    if (
      reviewerId !== null &&
      (!nonemptyString(reviewerId) ||
        !isObject(actors) ||
        !(Array.isArray(actors.reviewer) && actors.reviewer.includes(reviewerId)))
    ) {
      errors.push('task-status.json reviewerId is not registered as a reviewer actor');
    }
    if (review.independent === true) {
      const deliveryIds = new Set();
      if (isObject(actors)) {
        for (const id of Array.isArray(actors.leader) ? actors.leader : []) deliveryIds.add(id);
        for (const id of Array.isArray(actors.implementer) ? actors.implementer : []) deliveryIds.add(id);
      }
      if (deliveryIds.has(reviewerId)) {
        errors.push('independent review requires a reviewer identity separate from delivery actors');
      }
      if (review.mode !== 'independent-review') {
        errors.push('independent review requires independent-review mode');
      }
      if (actualReviewIsolations.length) {
        errors.push('independent review must not have a review-isolation degradation');
      }
    } else if (review.mode === 'review-pass') {
      const deliveryIds = new Set();
      if (isObject(actors)) {
        for (const id of Array.isArray(actors.leader) ? actors.leader : []) deliveryIds.add(id);
        for (const id of Array.isArray(actors.implementer) ? actors.implementer : []) deliveryIds.add(id);
      }
      if (!deliveryIds.has(reviewerId)) {
        errors.push('review-pass requires a reviewer identity shared with a delivery actor');
      }
      if (!actualReviewIsolations.length) {
        errors.push('review-pass requires a coherent review-isolation degradation');
      }
    }
  }

  if (Array.isArray(degraded) && !deepEqual(degraded, replayedReviewIsolations)) {
    errors.push('task-status.json degradedCapabilities do not match reviewer evidence');
  }

  if (isObject(review) && ['review-approved', 'final-init-passed', 'done'].includes(phase)) {
    if (review.approved !== true) errors.push('workflow requires review.approved=true');
    const checks = review.checks;
    const requiredChecks = own(REQUIRED_REVIEW_CHECKS, branch) || [];
    if (!Array.isArray(checks) || !requiredChecks.every((check) => checks.includes(check))) {
      errors.push('workflow review is missing branch-specific checks');
    }
  }
  if (phase === 'final-init-passed' || phase === 'done') {
    if (!isObject(validation) || validation.finalInitPassed !== true) {
      errors.push('workflow requires validation.finalInitPassed=true');
    } else if (!nonemptyString(validation.finalInitCommand)) {
      errors.push('workflow requires a final init command');
    }
  }
  return errors;
}

function checkpointValues(checkpointPath) {
  const problem = regularFileError(checkpointPath);
  if (problem) throw new WorkflowError(problem);
  const values = Object.create(null);
  for (const line of fs.readFileSync(checkpointPath, 'utf8').split(/\r?\n/)) {
    if (!line.includes(':') || line.startsWith(' ')) continue;
    const separator = line.indexOf(':');
    const key = line.slice(0, separator);
    const raw = line.slice(separator + 1).trim();
    try {
      values[key] = JSON.parse(raw);
    } catch {
      values[key] = raw;
    }
  }
  return values;
}

function requireCurrentCheckpoint(state, checkpointPath, target, actorRole, actorId) {
  const values = checkpointValues(checkpointPath);
  const expectedTrigger = target === 'delegated' ? 'before-delegation' : 'before-phase-change';
  if (values.trigger !== expectedTrigger) {
    throw new WorkflowError(`checkpoint trigger must be ${expectedTrigger} before ${target}`);
  }
  if (values.phase !== state.phase || values.next_phase !== target) {
    throw new WorkflowError('checkpoint phase does not match the requested transition');
  }
  if (values.state_sequence !== state.evidence.length) {
    throw new WorkflowError('checkpoint is stale for the current evidence sequence');
  }
  if (values.actor_role !== actorRole || values.actor_id !== actorId) {
    throw new WorkflowError('checkpoint actor does not match the requested transition');
  }
}

function appendActor(state, role, identity) {
  appendUnique(state.actors[role], identity);
}

function transition(state, args) {
  let errors = stateErrors(state);
  if (errors.length) throw new WorkflowError(errors.join('; '));
  const target = args.to;
  const expectedRole = TARGET_ROLES[target];
  if (args.actorRole !== expectedRole) {
    throw new WorkflowError(`transition to ${target} requires actor role ${expectedRole}`);
  }
  if (!nonemptyString(args.actorId) || !nonemptyString(args.evidence)) {
    throw new WorkflowError('actor identity and evidence are required');
  }

  const current = state.phase;
  const branch = current === 'uninitialized' ? args.branch : state.branch;
  if (!BRANCHES.includes(branch)) throw new WorkflowError('a valid branch is required for initialization');
  if (!(own(TRANSITIONS[branch], current) || []).includes(target)) {
    throw new WorkflowError(`invalid ${branch} transition: ${current} -> ${target}`);
  }
  if (current !== 'uninitialized') {
    requireCurrentCheckpoint(state, args.checkpoint, target, args.actorRole, args.actorId);
  }

  const actorId = args.actorId.trim();
  let reviewerId;
  let independent;
  let degradation;
  let checks;

  if (target === 'initialized') {
    if (!nonemptyString(args.task)) throw new WorkflowError('initialization requires --task');
    if (args.exitCode !== 0 || !nonemptyString(args.command)) {
      throw new WorkflowError('initialization requires a successful explicit init command');
    }
    state.task = args.task.trim();
    state.branch = branch;
    state.validation.initialInitPassed = true;
    state.validation.initialInitCommand = args.command.trim();
  } else if (target === 'analyzed') {
    if (!CLASSIFICATIONS.includes(args.classification)) {
      throw new WorkflowError('analysis requires --classification');
    }
    if (!nonemptyString(args.capabilityTier) || !nonemptyString(args.selectedModel)) {
      throw new WorkflowError('analysis requires separate capability tier and selected model');
    }
    state.classification = args.classification;
    state.capabilityTier = args.capabilityTier.trim();
    state.selectedModel = args.selectedModel.trim();
    if (current === 'review-rejected') Object.assign(state.review, emptyReview());
  } else if (target === 'delegated') {
    if (!nonemptyString(args.delegateId)) throw new WorkflowError('delegation requires --delegate-id');
    appendActor(state, 'implementer', args.delegateId.trim());
    if (current === 'review-rejected') Object.assign(state.review, emptyReview());
  } else if (target === 'implemented' || target === 'tested') {
    if (!state.actors.implementer.includes(args.actorId)) {
      throw new WorkflowError('implementer identity was not delegated');
    }
  } else if (target === 'review-pending') {
    if (!nonemptyString(args.reviewerId)) throw new WorkflowError('review request requires --reviewer-id');
    reviewerId = args.reviewerId.trim();
    const priorDeliveryIds = new Set([...state.actors.leader, ...state.actors.implementer]);
    independent = !priorDeliveryIds.has(reviewerId);
    if (!independent && !nonemptyString(args.degradedReview)) {
      throw new WorkflowError('shared reviewer identity requires --degraded-review');
    }
    appendActor(state, 'reviewer', reviewerId);
    state.degradedCapabilities = state.degradedCapabilities.filter(
      (value) => !value.startsWith('review-isolation:'),
    );
    Object.assign(state.review, {
      approved: null,
      reviewerId,
      independent,
      mode: independent ? 'independent-review' : 'review-pass',
      checks: [],
    });
    if (!independent) {
      degradation = `review-isolation:${args.degradedReview.trim()}`;
      if (!state.degradedCapabilities.includes(degradation)) state.degradedCapabilities.push(degradation);
    }
  } else if (target === 'review-approved' || target === 'review-rejected') {
    if (args.actorId !== state.review.reviewerId) {
      throw new WorkflowError('review result must come from the assigned reviewer identity');
    }
    checks = uniqueSorted(args.reviewCheck || []);
    if (target === 'review-approved') {
      const missing = REQUIRED_REVIEW_CHECKS[branch].filter((check) => !checks.includes(check)).sort();
      if (missing.length) throw new WorkflowError(`review approval is missing checks: ${missing.join(', ')}`);
    }
    state.review.approved = target === 'review-approved';
    state.review.checks = checks;
  } else if (target === 'final-init-passed') {
    if (state.review.approved !== true) throw new WorkflowError('final init requires reviewer approval');
    if (args.exitCode !== 0 || !nonemptyString(args.command)) {
      throw new WorkflowError('final validation requires a successful explicit init command');
    }
    state.validation.finalInitPassed = true;
    state.validation.finalInitCommand = args.command.trim();
  } else if (target === 'done') {
    if (state.review.approved !== true || state.validation.finalInitPassed !== true) {
      throw new WorkflowError('done requires reviewer approval and final init');
    }
  }

  appendActor(state, args.actorRole, actorId);
  state.phase = target;
  state.status = target === 'done' ? 'done' : 'in-progress';
  const event = {
    sequence: state.evidence.length + 1,
    timestamp: utcNow(),
    branch,
    from: current,
    to: target,
    actorRole: args.actorRole,
    actorId,
    summary: args.evidence.trim(),
  };
  if (target === 'initialized') {
    Object.assign(event, { task: args.task.trim(), command: args.command.trim(), exitCode: args.exitCode });
  } else if (target === 'analyzed') {
    Object.assign(event, {
      classification: args.classification,
      capabilityTier: args.capabilityTier.trim(),
      selectedModel: args.selectedModel.trim(),
    });
  } else if (target === 'delegated') {
    event.delegateId = args.delegateId.trim();
  } else if (target === 'review-pending') {
    Object.assign(event, { reviewerId, independent, mode: independent ? 'independent-review' : 'review-pass' });
    if (!independent) event.degradation = degradation;
  } else if (target === 'review-approved' || target === 'review-rejected') {
    event.checks = checks;
  } else if (target === 'final-init-passed') {
    Object.assign(event, { command: args.command.trim(), exitCode: args.exitCode });
  }
  state.evidence.push(event);

  errors = stateErrors(state);
  if (errors.length) throw new WorkflowError(errors.join('; '));
  return state;
}

function quote(value) {
  return JSON.stringify(value);
}

function writeCheckpoint(state, args) {
  const errors = stateErrors(state);
  if (errors.length) throw new WorkflowError(errors.join('; '));
  if (!nonemptyString(args.actorId)) throw new WorkflowError('checkpoint requires an actor identity');
  if (args.trigger === 'before-phase-change' || args.trigger === 'before-delegation') {
    if (!args.nextPhase) throw new WorkflowError('phase/delegation checkpoint requires --next-phase');
    const branch = state.branch;
    const graph = own(TRANSITIONS, branch);
    if (!graph || !(own(graph, state.phase) || []).includes(args.nextPhase)) {
      throw new WorkflowError('checkpoint next phase is not a valid transition');
    }
    if (args.trigger === 'before-delegation' && args.nextPhase !== 'delegated') {
      throw new WorkflowError('before-delegation checkpoint must target delegated');
    }
    if (args.trigger === 'before-phase-change' && args.nextPhase === 'delegated') {
      throw new WorkflowError('use before-delegation for a delegated transition');
    }
  }
  const content = [
    `objective: ${quote(args.objective || state.task || '')}`,
    `trigger: ${quote(args.trigger)}`,
    `phase: ${quote(state.phase)}`,
    `next_phase: ${quote(args.nextPhase === undefined ? null : args.nextPhase)}`,
    `state_sequence: ${state.evidence.length}`,
    `actor_role: ${quote(args.actorRole)}`,
    `actor_id: ${quote(args.actorId)}`,
    `decisions: ${quote(args.decision || [])}`,
    `files: ${quote(args.file || [])}`,
    `tests: ${quote(args.test || [])}`,
    `blockers: ${quote(args.blocker || [])}`,
    `next_steps: ${quote(args.nextStep || [])}`,
    '',
  ].join('\n');
  writeTextAtomic(args.checkpoint, content);
}

// --- Command line parsing (argparse-compatible subset) ---------------------

const PROGRAM = 'workflow_state.js';
const STATE_OPTION = { flag: '--state', dest: 'state', default: '.harness/task-status.json' };
const CHECKPOINT_OPTION = {
  flag: '--checkpoint',
  dest: 'checkpoint',
  default: '.harness/context/task-context.toon',
};
const TARGETS = Object.keys(TARGET_ROLES);

const COMMANDS = {
  check: {
    help: 'Validate the current state without writing.',
    options: [STATE_OPTION],
  },
  transition: {
    help: 'Record one guarded phase transition.',
    options: [
      STATE_OPTION,
      CHECKPOINT_OPTION,
      { flag: '--to', dest: 'to', required: true, choices: TARGETS },
      { flag: '--actor-role', dest: 'actorRole', required: true, choices: ROLES },
      { flag: '--actor-id', dest: 'actorId', required: true },
      { flag: '--evidence', dest: 'evidence', required: true },
      { flag: '--task', dest: 'task' },
      { flag: '--branch', dest: 'branch', choices: BRANCHES },
      { flag: '--classification', dest: 'classification', choices: CLASSIFICATIONS },
      { flag: '--capability-tier', dest: 'capabilityTier' },
      { flag: '--selected-model', dest: 'selectedModel' },
      { flag: '--delegate-id', dest: 'delegateId' },
      { flag: '--reviewer-id', dest: 'reviewerId' },
      { flag: '--degraded-review', dest: 'degradedReview' },
      { flag: '--review-check', dest: 'reviewCheck', append: true, choices: ALL_REVIEW_CHECKS },
      { flag: '--command', dest: 'command' },
      { flag: '--exit-code', dest: 'exitCode', type: 'int' },
    ],
  },
  checkpoint: {
    help: 'Write an observable continuity checkpoint.',
    options: [
      STATE_OPTION,
      CHECKPOINT_OPTION,
      { flag: '--trigger', dest: 'trigger', required: true, choices: CHECKPOINT_TRIGGERS },
      { flag: '--next-phase', dest: 'nextPhase', choices: TARGETS },
      { flag: '--actor-role', dest: 'actorRole', required: true, choices: ROLES },
      { flag: '--actor-id', dest: 'actorId', required: true },
      { flag: '--objective', dest: 'objective' },
      { flag: '--decision', dest: 'decision', append: true },
      { flag: '--file', dest: 'file', append: true },
      { flag: '--test', dest: 'test', append: true },
      { flag: '--blocker', dest: 'blocker', append: true },
      { flag: '--next-step', dest: 'nextStep', append: true },
    ],
  },
};

class UsageError extends Error {}

function usage(command) {
  if (!command) return `usage: ${PROGRAM} [-h] {${Object.keys(COMMANDS).join(',')}} ...`;
  const flags = COMMANDS[command].options
    .map((option) => (option.required ? `${option.flag} VALUE` : `[${option.flag} VALUE]`))
    .join(' ');
  return `usage: ${PROGRAM} ${command} [-h] ${flags}`;
}

function helpText(command) {
  if (!command) {
    const lines = [usage(), '', 'Record and validate Custom Harness workflow state without executing commands.', '', 'actions:'];
    for (const [name, spec] of Object.entries(COMMANDS)) lines.push(`  ${name.padEnd(12)}${spec.help}`);
    return lines.join('\n');
  }
  const lines = [usage(command), '', COMMANDS[command].help, '', 'options:'];
  for (const option of COMMANDS[command].options) {
    let detail = option.flag;
    if (option.choices) detail += ` {${option.choices.join(',')}}`;
    else detail += ' VALUE';
    if (option.default !== undefined) detail += ` (default: ${option.default})`;
    if (option.append) detail += ' (repeatable)';
    if (option.required) detail += ' (required)';
    lines.push(`  ${detail}`);
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  if (!argv.length) throw new UsageError(`${usage()}\n${PROGRAM}: error: the following arguments are required: action`);
  if (argv[0] === '-h' || argv[0] === '--help') return { help: helpText() };
  const action = argv[0];
  if (!Object.prototype.hasOwnProperty.call(COMMANDS, action)) {
    throw new UsageError(
      `${usage()}\n${PROGRAM}: error: argument action: invalid choice: '${action}' (choose from ${Object.keys(COMMANDS).join(', ')})`,
    );
  }
  const spec = COMMANDS[action];
  const byFlag = new Map(spec.options.map((option) => [option.flag, option]));
  const args = { action };
  for (const option of spec.options) {
    if (option.append) args[option.dest] = undefined;
    else if (option.default !== undefined) args[option.dest] = option.default;
    else args[option.dest] = undefined;
  }
  const fail = (message) => new UsageError(`${usage(action)}\n${PROGRAM} ${action}: error: ${message}`);

  let index = 1;
  while (index < argv.length) {
    const token = argv[index];
    if (token === '-h' || token === '--help') return { help: helpText(action) };
    if (!token.startsWith('--')) throw fail(`unrecognized arguments: ${argv.slice(index).join(' ')}`);
    let flag = token;
    let value;
    const equals = token.indexOf('=');
    if (equals >= 0) {
      flag = token.slice(0, equals);
      value = token.slice(equals + 1);
    }
    const option = byFlag.get(flag);
    if (!option) throw fail(`unrecognized arguments: ${token}`);
    if (value === undefined) {
      index += 1;
      if (index >= argv.length) throw fail(`argument ${flag}: expected one argument`);
      value = argv[index];
    }
    if (option.choices && !option.choices.includes(value)) {
      throw fail(
        `argument ${flag}: invalid choice: '${value}' (choose from ${option.choices.map((c) => `'${c}'`).join(', ')})`,
      );
    }
    if (option.type === 'int') {
      if (!/^[+-]?\d+$/.test(value.trim())) throw fail(`argument ${flag}: invalid int value: '${value}'`);
      value = Number.parseInt(value, 10);
    }
    if (option.append) {
      if (!args[option.dest]) args[option.dest] = [];
      args[option.dest].push(value);
    } else {
      args[option.dest] = value;
    }
    index += 1;
  }
  const missing = spec.options.filter((option) => option.required && args[option.dest] === undefined);
  if (missing.length) {
    throw fail(`the following arguments are required: ${missing.map((option) => option.flag).join(', ')}`);
  }
  return { args };
}

function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n`);
      return 2;
    }
    throw error;
  }
  if (parsed.help) {
    process.stdout.write(`${parsed.help}\n`);
    return 0;
  }
  const args = parsed.args;
  try {
    const state = loadState(args.state);
    if (args.action === 'check') {
      const errors = stateErrors(state);
      if (errors.length) {
        for (const error of errors) process.stderr.write(`error: ${error}\n`);
        return 1;
      }
      process.stdout.write('custom-harness state: valid\n');
      return 0;
    }
    if (args.action === 'checkpoint') {
      writeCheckpoint(state, args);
      process.stdout.write(`checkpoint recorded: ${args.trigger}\n`);
      return 0;
    }
    const updated = transition(state, args);
    writeState(args.state, updated);
    const last = updated.evidence[updated.evidence.length - 1];
    process.stdout.write(`transition recorded: ${last.from} -> ${updated.phase}\n`);
    return 0;
  } catch (error) {
    if (error instanceof WorkflowError || (error && typeof error.code === 'string')) {
      process.stderr.write(`error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

module.exports = {
  SCHEMA_VERSION,
  BRANCHES,
  CLASSIFICATIONS,
  ROLES,
  CHECKPOINT_TRIGGERS,
  TRANSITIONS,
  TARGET_ROLES,
  REQUIRED_REVIEW_CHECKS,
  WorkflowError,
  utcNow,
  defaultState,
  stateErrors,
  loadState,
  writeState,
  writeTextAtomic,
  checkpointValues,
  transition,
  writeCheckpoint,
  parseArgs,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
