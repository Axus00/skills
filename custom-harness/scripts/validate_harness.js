#!/usr/bin/env node
'use strict';
/** Validate a Custom Harness skill source or installed consumer adapter. */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');
const vm = require('node:vm');

const WORKFLOW = require('./workflow_state.js');
const toml = require('./toml_lite.js');

const DESCRIPTION = 'Validate a Custom Harness skill source or installed consumer adapter.';

const SKILL_REQUIRED = [
  'SKILL.md',
  'agents/openai.yaml',
  'references/architecture.md',
  'references/configuration.md',
  'references/adapters.md',
  'references/distribution.md',
  'references/project-context.md',
  'references/memanto.md',
  'scripts/install_harness.js',
  'scripts/validate_harness.js',
  'scripts/workflow_state.js',
  'scripts/toml_lite.js',
  'assets/templates/shared/.harness/config.toml',
  'assets/templates/shared/.harness/contract.md',
  'assets/templates/shared/.harness/task-status.json',
  'assets/templates/shared/.harness/context/task-context.toon',
];

const COMMON_INSTALLED = [
  '.harness/config.toml',
  '.harness/contract.md',
  '.harness/bin/workflow_state.js',
  '.harness/references/project-context.md',
  '.harness/references/memanto.md',
  '.harness/task-status.json',
  '.harness/context/task-context.toon',
];

const INSTALLED_REQUIRED = {
  codex: [
    'AGENTS.md',
    '.codex/agents/leader.toml',
    '.codex/agents/implementer.toml',
    '.codex/agents/reviewer.toml',
    '.agents/skills/custom-harness/SKILL.md',
  ],
  claude: [
    'CLAUDE.md',
    '.claude/agents/leader.md',
    '.claude/agents/implementer.md',
    '.claude/agents/reviewer.md',
    '.claude/skills/custom-harness/SKILL.md',
  ],
  cursor: ['.cursor/rules/custom-harness.mdc'],
};

const FORBIDDEN_TEXT = [
  ['state clearing instruction', /(?:clear|empty|truncate|delete|remove).{0,80}task-status\.json/],
  ['ambiguous percentage checkpoint', /(?:approximately|about|near|around)?\s*40\s*%/],
  ['duplicate Codex state authority', /\.codex\/(?:\.context\/)?task-(?:status|context)/],
];

const ROLE_RULES = {
  leader: [
    ['classification', /classif/],
    ['capability tier', /capabilitytier|capability tier/],
    ['selected model', /selectedmodel|selected model/],
    ['delegation', /delegat|route/],
    ['checkpoint', /checkpoint/],
    ['project context gate', /project.context gate/],
    [
      'owned transitions',
      /record only.{0,80}analyzed.{0,40}delegated.{0,40}review-pending.{0,40}final-init-passed.{0,40}done/,
    ],
    ['state engine authority', /workflow_state\.js.{0,80}never edit state/],
    ['no implementation', /never (?:edit implementation|implement)/],
    ['no self approval', /self-approve|approve your own/],
    ['final init before done', /final.init.{0,100}(?:before|then|explicitly.{0,40}record).{0,60}done/],
  ],
  implementer: [
    ['delegated identity', /delegated.{0,80}(?:identity|scope)/],
    ['preserve changes', /preserve/],
    ['tests', /tests/],
    ['state evidence', /implemented.{0,80}tested|tested.{0,80}implemented/],
    ['owned transitions', /record only.{0,40}implemented.{0,40}tested/],
    ['state engine authority', /workflow_state\.js.{0,80}never edit state/],
    ['cannot approve', /never approve/],
    ['cannot close', /(?:never|do not).{0,40}done/],
  ],
  reviewer: [
    ['assigned identity', /assign(?:ed|s)?.{0,80}(?:identity|review)/],
    ['no implementation edits', /without changing implementation|no implementation edits/],
    ['conditional review', /review.{0,160}install-adapt.{0,160}package/],
    ['approve or reject', /review-approved.{0,80}review-rejected|review-rejected.{0,80}review-approved/],
    [
      'owned transitions',
      /record only.{0,60}review-approved.{0,40}review-rejected|record only.{0,60}review-rejected.{0,40}review-approved/,
    ],
    ['state engine authority', /workflow_state\.js.{0,80}never edit state/],
    ['cannot close', /never.{0,60}done/],
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function isSymlink(target) {
  const info = lstatOrNull(target);
  return info !== null && info.isSymbolicLink();
}

function isFile(target) {
  const info = statOrNull(target);
  return info !== null && info.isFile();
}

function existsOrSymlink(target) {
  return statOrNull(target) !== null || isSymlink(target);
}

function missingOrEmpty(target) {
  if (isSymlink(target)) {
    return true;
  }
  const info = statOrNull(target);
  return info === null || !info.isFile() || info.size === 0;
}

function readUtf8(target, label) {
  if (missingOrEmpty(target)) {
    return [null, [`missing or empty: ${label}`]];
  }
  try {
    return [UTF8_DECODER.decode(fs.readFileSync(target)), []];
  } catch (error) {
    return [null, [`not readable UTF-8: ${label}: ${error.message}`]];
  }
}

function normalized(content) {
  return content.toLowerCase().replace(/\s+/g, ' ');
}

function ruleErrors(label, content, rules) {
  const value = normalized(content);
  return rules.filter(([, pattern]) => !pattern.test(value)).map(([name]) => `${label} semantic invariant missing: ${name}`);
}

function forbiddenErrors(label, content) {
  const value = normalized(content);
  return FORBIDDEN_TEXT.filter(([, pattern]) => pattern.test(value)).map(([name]) => `${label} forbidden invariant: ${name}`);
}

function splitLines(content) {
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function frontmatter(content, label) {
  const lines = splitLines(content);
  if (lines.length === 0 || lines[0] !== '---') {
    return [{}, [`${label} must start with YAML frontmatter`]];
  }
  const closing = lines.indexOf('---', 1);
  if (closing < 0) {
    return [{}, [`${label} frontmatter is not closed`]];
  }
  const values = {};
  const errors = [];
  for (const line of lines.slice(1, closing)) {
    if (!line.trim()) {
      continue;
    }
    const separator = line.indexOf(':');
    if (separator < 0) {
      errors.push(`${label} invalid frontmatter line: ${line}`);
      continue;
    }
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return [values, errors];
}

function sameKeySet(object, expected) {
  const keys = Object.keys(object);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function skillPointerErrors(target, platform) {
  const [content, errors] = readUtf8(target, `${platform} skill pointer`);
  if (content === null) {
    return errors;
  }
  const [metadata, metadataErrors] = frontmatter(content, `${platform} skill pointer`);
  errors.push(...metadataErrors);
  if (metadata.name !== 'custom-harness' || !metadata.description) {
    errors.push(`${platform} skill pointer requires name and description`);
  }
  if (!sameKeySet(metadata, ['name', 'description'])) {
    errors.push(`${platform} skill pointer frontmatter must contain only name and description`);
  }
  if (!content.includes('.harness/contract.md')) {
    errors.push(`${platform} skill pointer must reference .harness/contract.md`);
  }
  if (!content.includes('single authoritative installed contract')) {
    errors.push(`${platform} skill pointer must remain non-authoritative`);
  }
  return errors;
}

function dispatcherErrors(target, platform) {
  const [content, errors] = readUtf8(target, `${platform} dispatcher`);
  if (content === null) {
    return errors;
  }
  errors.push(...forbiddenErrors(`${platform} dispatcher`, content));
  const rules = [
    ['portable contract', /\.harness\/contract\.md/],
    ['init before analysis', /before analyz.{0,160}(?:run|execute).{0,80}init|before.{0,80}analyz.{0,80}init/],
    ['initialized evidence', /record.{0,80}initialized/],
    ['leader dispatch', /(?:spawn|invoke).{0,80}leader/],
    ['dispatcher no analysis', /dispatcher.{0,100}no functional analysis|performs no functional analysis/],
    ['branch routing', /review.{0,100}reviewer.{0,140}install-adapt.{0,100}implementer/],
    ['state engine authority', /only.{0,80}workflow_state\.js.{0,40}mutat/],
    [
      'role transition ownership',
      /dispatcher.{0,40}initialized.{0,100}leader.{0,120}final-init-passed.{0,40}done.{0,100}implementer.{0,60}implemented.{0,40}tested.{0,100}reviewer.{0,60}review-approved.{0,40}review-rejected/,
    ],
    ['final gate', /reviewer approval.{0,100}final init/],
  ];
  errors.push(...ruleErrors(`${platform} dispatcher`, content, rules));
  const value = normalized(content);
  const initPosition = value.indexOf('before analyz');
  const leaderPosition = Math.max(value.indexOf('spawn'), value.indexOf('invoke'));
  if (initPosition < 0 || leaderPosition < 0 || initPosition > leaderPosition) {
    errors.push(`${platform} dispatcher must place init before leader dispatch`);
  }
  return errors;
}

function codexAgentErrors(target, role) {
  const [content, errors] = readUtf8(target, `codex ${role} agent`);
  if (content === null) {
    return errors;
  }
  let data;
  try {
    data = toml.parse(content);
  } catch (error) {
    return [`codex ${role} agent invalid TOML: ${error.message}`];
  }
  for (const field of ['name', 'description', 'developer_instructions']) {
    if (typeof data[field] !== 'string' || !data[field].trim()) {
      errors.push(`codex ${role} agent missing string field: ${field}`);
    }
  }
  if (data.name !== role) {
    errors.push(`codex ${role} agent name must match its role`);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'model')) {
    errors.push(`codex ${role} agent must not pin a model`);
  }
  const instructions = typeof data.developer_instructions === 'string' ? data.developer_instructions : '';
  errors.push(...ruleErrors(`codex ${role} agent`, instructions, ROLE_RULES[role]));
  errors.push(...forbiddenErrors(`codex ${role} agent`, instructions));
  return errors;
}

function claudeAgentErrors(target, role) {
  const [content, errors] = readUtf8(target, `claude ${role} agent`);
  if (content === null) {
    return errors;
  }
  const [metadata, metadataErrors] = frontmatter(content, `claude ${role} agent`);
  errors.push(...metadataErrors);
  for (const field of ['name', 'description', 'tools']) {
    if (!metadata[field]) {
      errors.push(`claude ${role} agent missing frontmatter field: ${field}`);
    }
  }
  if (metadata.name !== role) {
    errors.push(`claude ${role} agent name must match its role`);
  }
  if (role === 'reviewer' && ['Edit', 'Write'].some((tool) => (metadata.tools || '').includes(tool))) {
    errors.push('claude reviewer must not receive Edit or Write tools');
  }
  errors.push(...ruleErrors(`claude ${role} agent`, content, ROLE_RULES[role]));
  errors.push(...forbiddenErrors(`claude ${role} agent`, content));
  return errors;
}

function cursorErrors(target) {
  const [content, errors] = readUtf8(target, 'cursor rule');
  if (content === null) {
    return errors;
  }
  const [metadata, metadataErrors] = frontmatter(content, 'cursor rule');
  errors.push(...metadataErrors);
  if (metadata.alwaysApply !== 'true' || !metadata.description) {
    errors.push('cursor rule requires description and alwaysApply: true');
  }
  const rules = [
    ['authoritative rule', /authoritative cursor rule/],
    ['portable contract', /\.harness\/contract\.md/],
    ['init before analysis', /before analysis.{0,120}(?:run|execute).{0,80}init/],
    ['project context gate', /project.context gate/],
    ['separate execution', /separate chats or cli invocations/],
    ['degraded review', /review-isolation/],
    ['review pass label', /review-pass/],
    ['independent warning', /never an independent review/],
    ['review branch skips install', /review.{0,80}reviewer.{0,80}without installation/],
    ['observable checkpoints', /transition.{0,80}delegation.{0,80}compaction.{0,80}handoff/],
    ['state engine authority', /only.{0,80}workflow_state\.js.{0,40}mutat/],
    [
      'role transition ownership',
      /dispatcher.{0,40}initialized.{0,100}leader.{0,120}final-init-passed.{0,40}done.{0,100}implementer.{0,60}implemented.{0,40}tested.{0,100}reviewer.{0,60}review-approved.{0,40}review-rejected/,
    ],
    ['final gate', /reviewer approval.{0,100}final init/],
  ];
  errors.push(...ruleErrors('cursor rule', content, rules));
  errors.push(...forbiddenErrors('cursor rule', content));
  return errors;
}

function contractErrors(target) {
  const [content, errors] = readUtf8(target, 'portable contract');
  if (content === null) {
    return errors;
  }
  const rules = [
    ['review graph', /review.{0,160}initialized.{0,80}analyzed.{0,80}review-pending/],
    ['delivery graph', /install-adapt.{0,180}delegated.{0,80}implemented.{0,80}tested/],
    ['final graph', /review-approved.{0,80}final-init-passed.{0,80}done/],
    ['single state', /only workflow state/],
    ['state engine authority', /only.{0,80}workflow_state\.js.{0,80}mutat/],
    ['dispatcher transition ownership', /dispatcher.{0,60}record only.{0,40}initialized/],
    [
      'leader transition ownership',
      /leader.{0,100}record only.{0,100}analyzed.{0,40}delegated.{0,40}review-pending.{0,40}final-init-passed.{0,40}done/,
    ],
    ['implementer transition ownership', /implementer.{0,120}record only.{0,40}implemented.{0,40}tested/],
    ['reviewer transition ownership', /reviewer.{0,120}record only.{0,60}review-approved.{0,40}review-rejected/],
    ['separate model fields', /capabilitytier.{0,80}selectedmodel/],
    ['actor evidence', /actor role.{0,80}actor identity.{0,80}evidence/],
    ['checkpoint triggers', /phase transition.{0,80}delegation.{0,80}compaction.{0,80}handoff/],
    ['review isolation', /review-isolation/],
    ['review pass', /review-pass/],
    ['conditional distribution', /package.{0,100}distribution/],
    ['no config execution', /never executes them automatically|never launch/],
    ['project context gate', /project context gate/],
    [
      'memory separate from state',
      /durable.{0,80}memory.{0,120}task-status\.json|memory.{0,60}separate.{0,60}(?:workflow|execution) state/,
    ],
  ];
  errors.push(...ruleErrors('portable contract', content, rules));
  errors.push(...forbiddenErrors('portable contract', content));
  return errors;
}

function taskStatusErrors(target) {
  const [content, errors] = readUtf8(target, 'task-status.json');
  if (content === null) {
    return errors;
  }
  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    return [`invalid task-status.json: ${error.message}`];
  }
  return WORKFLOW.stateErrors(state);
}

function checkpointErrors(target) {
  const [content, errors] = readUtf8(target, 'task-context.toon');
  if (content === null) {
    return errors;
  }
  const required = [
    'objective',
    'trigger',
    'phase',
    'next_phase',
    'state_sequence',
    'actor_role',
    'actor_id',
    'decisions',
    'files',
    'tests',
    'blockers',
    'next_steps',
  ];
  for (const field of required) {
    if (!new RegExp(`^${escapeRegExp(field)}\\s*:`, 'm').test(content)) {
      errors.push(`task-context.toon missing field: ${field}`);
    }
  }
  return errors;
}

/** Remove JavaScript comments while leaving string, template, and regex bodies intact. */
function stripComments(source) {
  let output = '';
  let index = 0;
  const length = source.length;
  let previousSignificant = '';
  while (index < length) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '/' && next === '/') {
      while (index < length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      output += ' ';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      output += character;
      index += 1;
      while (index < length && source[index] !== quote) {
        if (source[index] === '\\') {
          output += source[index];
          index += 1;
        }
        if (index < length) {
          output += source[index];
          index += 1;
        }
      }
      output += quote;
      index += 1;
      previousSignificant = quote;
      continue;
    }
    if (character === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(previousSignificant)) {
      // Regex literal: copy until the unescaped closing slash outside a class.
      output += character;
      index += 1;
      let inClass = false;
      while (index < length && source[index] !== '\n') {
        const current = source[index];
        if (current === '\\') {
          output += current + (source[index + 1] || '');
          index += 2;
          continue;
        }
        if (current === '[') {
          inClass = true;
        } else if (current === ']') {
          inClass = false;
        } else if (current === '/' && !inClass) {
          break;
        }
        output += current;
        index += 1;
      }
      output += '/';
      index += 1;
      previousSignificant = '/';
      continue;
    }
    output += character;
    if (!/\s/.test(character)) {
      previousSignificant = character;
    }
    index += 1;
  }
  return output;
}

const BANNED_IMPORT_PATTERNS = [
  /\brequire\s*\(\s*['"`](?:node:)?child_process['"`]\s*\)/,
  /\bimport\b[^;]*?\bfrom\s*['"`](?:node:)?child_process['"`]/,
  /\bimport\s*\(?\s*['"`](?:node:)?child_process['"`]/,
  /\bprocess\s*\.\s*binding\b/,
];

const BANNED_CALLS = ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork', 'system', 'popen'];

function engineErrors(target) {
  const [content, errors] = readUtf8(target, 'workflow state engine');
  if (content === null) {
    return errors;
  }
  try {
    // eslint-disable-next-line no-new
    new vm.Script(content, { filename: path.basename(target) });
  } catch (error) {
    return [`workflow state engine invalid JavaScript: ${error.message}`];
  }
  const stripped = stripComments(content);
  if (BANNED_IMPORT_PATTERNS.some((pattern) => pattern.test(stripped))) {
    errors.push('workflow state engine must not import command execution modules');
  }
  const callPattern = new RegExp(`\\.\\s*(${BANNED_CALLS.join('|')})\\s*\\(`, 'g');
  for (const match of stripped.matchAll(callPattern)) {
    errors.push(`workflow state engine must not execute commands: ${match[1]}`);
  }
  const sourceRules = [
    ['branch graphs', /transitions\s*=/],
    ['actor roles', /target_roles\s*=/],
    ['review checks', /required_review_checks\s*=/],
    ['initial gate', /initialinitpassed/],
    ['final gate', /finalinitpassed/],
    ['selected model', /selectedmodel/],
    ['checkpoint sequence', /state_sequence/],
  ];
  errors.push(...ruleErrors('workflow state engine', content, sourceRules));
  return [...new Set(errors)];
}

function platformErrors(base, platform) {
  if (platform === 'codex') {
    const errors = dispatcherErrors(path.join(base, 'AGENTS.md'), platform);
    for (const role of ['leader', 'implementer', 'reviewer']) {
      errors.push(...codexAgentErrors(path.join(base, '.codex', 'agents', `${role}.toml`), role));
    }
    errors.push(...skillPointerErrors(path.join(base, '.agents', 'skills', 'custom-harness', 'SKILL.md'), platform));
    for (const obsolete of ['.agents/leader.md', '.agents/implementer.md', '.agents/reviewer.md']) {
      if (existsOrSymlink(path.join(base, obsolete))) {
        errors.push(`codex obsolete role contract must not be installed: ${obsolete}`);
      }
    }
    return errors;
  }
  if (platform === 'claude') {
    const errors = dispatcherErrors(path.join(base, 'CLAUDE.md'), platform);
    for (const role of ['leader', 'implementer', 'reviewer']) {
      errors.push(...claudeAgentErrors(path.join(base, '.claude', 'agents', `${role}.md`), role));
    }
    errors.push(...skillPointerErrors(path.join(base, '.claude', 'skills', 'custom-harness', 'SKILL.md'), platform));
    return errors;
  }
  return cursorErrors(path.join(base, '.cursor', 'rules', 'custom-harness.mdc'));
}

function skillRouterErrors(target) {
  const [content, errors] = readUtf8(target, 'SKILL.md');
  if (content === null) {
    return errors;
  }
  const [metadata, metadataErrors] = frontmatter(content, 'SKILL.md');
  errors.push(...metadataErrors);
  if (!sameKeySet(metadata, ['name', 'description'])) {
    errors.push('SKILL.md frontmatter must contain only name and description');
  }
  if (metadata.name !== 'custom-harness' || !metadata.description) {
    errors.push('SKILL.md requires custom-harness name and description');
  }
  for (const heading of ['## Common gate', '## Review branch', '## Install-adapt branch', '## Package branch']) {
    if (!content.includes(heading)) {
      errors.push(`SKILL.md missing router heading: ${heading}`);
    }
  }
  const reviewMatch = /## Review branch([\s\S]*?)(?=\n## |$)/.exec(content);
  if (
    !reviewMatch ||
    !/Do not preview installation[\s\S]*invoke the installer[\s\S]*implement changes[\s\S]*distribution checks/.test(
      reviewMatch[1],
    )
  ) {
    errors.push('SKILL.md review branch must prohibit install, implementation, and unconditional distribution');
  }
  if (!content.includes('[distribution.md](references/distribution.md) only for the `package` branch')) {
    errors.push('SKILL.md must disclose distribution reference only for package');
  }
  if (/\bTODO\b/.test(content)) {
    errors.push('SKILL.md contains a TODO placeholder');
  }
  errors.push(...forbiddenErrors('SKILL.md', content));
  return errors;
}

function validateSkill(root) {
  const errors = [];
  for (const relative of SKILL_REQUIRED) {
    if (missingOrEmpty(path.join(root, ...relative.split('/')))) {
      errors.push(`missing or empty: ${relative}`);
    }
  }
  errors.push(...skillRouterErrors(path.join(root, 'SKILL.md')));
  errors.push(...engineErrors(path.join(root, 'scripts', 'workflow_state.js')));

  const shared = path.join(root, 'assets', 'templates', 'shared');
  errors.push(...contractErrors(path.join(shared, '.harness', 'contract.md')));
  errors.push(...taskStatusErrors(path.join(shared, '.harness', 'task-status.json')));
  errors.push(...checkpointErrors(path.join(shared, '.harness', 'context', 'task-context.toon')));

  for (const [platform, required] of Object.entries(INSTALLED_REQUIRED)) {
    const base = path.join(root, 'assets', 'templates', platform);
    for (const relative of required) {
      if (missingOrEmpty(path.join(base, ...relative.split('/')))) {
        errors.push(`${platform} template missing: ${relative}`);
      }
    }
    errors.push(...platformErrors(base, platform));
  }
  return errors;
}

function validateTarget(target, platforms) {
  const errors = [];
  const required = [...COMMON_INSTALLED, ...platforms.flatMap((platform) => INSTALLED_REQUIRED[platform])];
  for (const relative of required) {
    if (missingOrEmpty(path.join(target, ...relative.split('/')))) {
      errors.push(`missing or empty: ${relative}`);
    }
  }
  errors.push(...contractErrors(path.join(target, '.harness', 'contract.md')));
  errors.push(...engineErrors(path.join(target, '.harness', 'bin', 'workflow_state.js')));
  errors.push(...taskStatusErrors(path.join(target, '.harness', 'task-status.json')));
  errors.push(...checkpointErrors(path.join(target, '.harness', 'context', 'task-context.toon')));
  for (const platform of platforms) {
    errors.push(...platformErrors(target, platform));
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Argument parsing (argparse-compatible surface)
// ---------------------------------------------------------------------------

const PROG = 'validate_harness.js';
const USAGE = `usage: ${PROG} [-h] (--skill-root SKILL_ROOT | --target TARGET) [--platform {codex,claude,cursor}]`;
const HELP = `${USAGE}

${DESCRIPTION}

options:
  -h, --help            show this help message and exit
  --skill-root SKILL_ROOT
  --target TARGET
  --platform {codex,claude,cursor}
`;

class UsageError extends Error {}

class HelpRequested extends Error {}

function parseArgs(argv) {
  const args = { skillRoot: null, target: null, platforms: null };
  const choices = Object.keys(INSTALLED_REQUIRED);
  const tokens = [...argv];
  let index = 0;
  let groupFlag = null;
  const nextValue = (flag) => {
    if (index + 1 >= tokens.length || (tokens[index + 1].startsWith('-') && tokens[index + 1] !== '-')) {
      throw new UsageError(`argument ${flag}: expected one argument`);
    }
    index += 1;
    return tokens[index];
  };
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === '-h' || token === '--help') {
      throw new HelpRequested();
    }
    let flag = token;
    let inlineValue = null;
    const equals = token.indexOf('=');
    if (token.startsWith('--') && equals > 0) {
      flag = token.slice(0, equals);
      inlineValue = token.slice(equals + 1);
    }
    if (flag === '--skill-root' || flag === '--target') {
      const value = inlineValue !== null ? inlineValue : nextValue(flag);
      if (groupFlag !== null && groupFlag !== flag) {
        throw new UsageError(`argument ${flag}: not allowed with argument ${groupFlag}`);
      }
      groupFlag = flag;
      args[flag === '--target' ? 'target' : 'skillRoot'] = value;
      index += 1;
      continue;
    }
    if (flag === '--platform') {
      const value = inlineValue !== null ? inlineValue : nextValue(flag);
      if (!choices.includes(value)) {
        throw new UsageError(
          `argument --platform: invalid choice: '${value}' (choose from ${choices.join(', ')})`,
        );
      }
      args.platforms = [...(args.platforms || []), value];
      index += 1;
      continue;
    }
    throw new UsageError(`unrecognized arguments: ${tokens.slice(index).join(' ')}`);
  }
  if (groupFlag === null) {
    throw new UsageError('one of the arguments --skill-root --target is required');
  }
  return args;
}

function resolvePath(value) {
  const absolute = path.resolve(value);
  try {
    return fs.realpathSync(absolute);
  } catch {
    return absolute;
  }
}

function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    if (error instanceof HelpRequested) {
      process.stdout.write(HELP);
      return 0;
    }
    if (error instanceof UsageError) {
      process.stderr.write(`${USAGE}\n${PROG}: error: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const errors = args.skillRoot
    ? validateSkill(resolvePath(args.skillRoot))
    : validateTarget(resolvePath(args.target), args.platforms || ['codex']);
  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`error: ${error}\n`);
    }
    return 1;
  }
  process.stdout.write('custom-harness: validation passed\n');
  return 0;
}

module.exports = {
  WORKFLOW,
  SKILL_REQUIRED,
  COMMON_INSTALLED,
  INSTALLED_REQUIRED,
  FORBIDDEN_TEXT,
  ROLE_RULES,
  readUtf8,
  normalized,
  ruleErrors,
  forbiddenErrors,
  frontmatter,
  skillPointerErrors,
  dispatcherErrors,
  codexAgentErrors,
  claudeAgentErrors,
  cursorErrors,
  contractErrors,
  taskStatusErrors,
  checkpointErrors,
  engineErrors,
  stripComments,
  platformErrors,
  skillRouterErrors,
  validateSkill,
  validateTarget,
  parseArgs,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
