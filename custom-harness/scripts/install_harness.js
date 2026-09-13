#!/usr/bin/env node
'use strict';
/** Install Custom Harness templates with preflighted, idempotent writes. */

const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

const DESCRIPTION = 'Install Custom Harness templates with preflighted, idempotent writes.';
const SKILL_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_ROOT = path.join(SKILL_ROOT, 'assets', 'templates');
const PLATFORMS = ['codex', 'claude', 'cursor'];
const RUNTIME_FILES = new Map([
  ['.harness/bin/workflow_state.js', path.join(SKILL_ROOT, 'scripts', 'workflow_state.js')],
  ['.harness/references/project-context.md', path.join(SKILL_ROOT, 'references', 'project-context.md')],
  ['.harness/references/memanto.md', path.join(SKILL_ROOT, 'references', 'memanto.md')],
]);

class PlannedFile {
  constructor(relativePath, content, action, backupPath = null, reason = null) {
    this.relativePath = relativePath;
    this.content = content;
    this.action = action;
    this.backupPath = backupPath;
    this.reason = reason;
    Object.freeze(this);
  }
}

// ---------------------------------------------------------------------------
// Filesystem helpers (lstat-based so symlinks are never followed implicitly).
// ---------------------------------------------------------------------------

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    if (error && error.code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'ELOOP')) {
      return null;
    }
    throw error;
  }
}

function isSymlink(target) {
  const info = lstatOrNull(target);
  return info !== null && info.isSymbolicLink();
}

function exists(target) {
  return statOrNull(target) !== null;
}

function isDir(target) {
  const info = statOrNull(target);
  return info !== null && info.isDirectory();
}

function isFile(target) {
  const info = statOrNull(target);
  return info !== null && info.isFile();
}

function hardLinkCount(target) {
  return fs.lstatSync(target).nlink;
}

function isWritable(target) {
  try {
    fs.accessSync(target, fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function posixParts(relative) {
  return relative.split('/').filter((part) => part !== '' && part !== '.');
}

function toPosix(relative) {
  return relative.split(path.sep).join('/');
}

function joinTarget(target, relative) {
  return path.join(target, ...posixParts(relative));
}

/** Parent directories of a POSIX relative path (excluding itself), like Path.parents. */
function parentsOf(relative) {
  const parts = posixParts(relative);
  const parents = [];
  for (let index = parts.length - 1; index > 0; index -= 1) {
    parents.push(parts.slice(0, index).join('/'));
  }
  parents.push('.');
  return parents;
}

function isAncestor(candidate, other) {
  return parentsOf(other).includes(candidate);
}

function walkFiles(base) {
  const results = [];
  const stack = [base];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        results.push(full);
      } else if (entry.isSymbolicLink() && isFile(full)) {
        results.push(full);
      }
    }
  }
  return results.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function readUtf8OrNull(target) {
  const buffer = fs.readFileSync(target);
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

function templateFiles(platforms, projectName) {
  const selected = ['shared', ...new Set(platforms)];
  const files = new Map();
  for (const group of selected) {
    const base = path.join(TEMPLATE_ROOT, group);
    if (!isDir(base)) {
      throw new Error(`Missing template group: ${group}`);
    }
    for (const source of walkFiles(base)) {
      const relative = toPosix(path.relative(base, source));
      const rendered = fs
        .readFileSync(source, 'utf8')
        .split('{{PROJECT_NAME_TOML}}')
        .join(JSON.stringify(projectName));
      const previous = files.get(relative);
      if (previous !== undefined && previous !== rendered) {
        throw new Error(`Adapters render conflicting content for ${relative}`);
      }
      files.set(relative, rendered);
    }
  }
  for (const [relative, source] of RUNTIME_FILES) {
    const rendered = fs.readFileSync(source, 'utf8');
    const previous = files.get(relative);
    if (previous !== undefined && previous !== rendered) {
      throw new Error(`Runtime renders conflicting content for ${relative}`);
    }
    files.set(relative, rendered);
  }
  return files;
}

function routeError(target, relative) {
  const parts = posixParts(relative);
  if (path.isAbsolute(relative) || relative.startsWith('/') || parts.includes('..')) {
    return 'path is outside target';
  }
  if (!isDir(target) || isSymlink(target)) {
    return 'target must be a real directory';
  }

  let current = target;
  let closestExisting = target;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    if (isSymlink(current)) {
      return `symlink ancestor: ${toPosix(path.relative(target, current))}`;
    }
    if (exists(current)) {
      if (!isDir(current)) {
        return `non-directory ancestor: ${toPosix(path.relative(target, current))}`;
      }
      closestExisting = current;
    }
  }
  if (!isWritable(closestExisting)) {
    const shown = closestExisting === target ? '.' : toPosix(path.relative(target, closestExisting));
    return `parent is not writable: ${shown}`;
  }
  return null;
}

function nextBackupPath(target, relative, reserved) {
  const base = `.harness/backups/${posixParts(relative).join('/')}`;
  let candidate = `${base}.bak`;
  let counter = 1;
  for (;;) {
    const absolute = joinTarget(target, candidate);
    if (!(reserved.has(candidate) || exists(absolute) || isSymlink(absolute))) {
      return [candidate, null];
    }
    if (isSymlink(absolute)) {
      return [candidate, 'candidate is a symlink'];
    }
    candidate = `${base}.bak.${counter}`;
    counter += 1;
  }
}

function buildPlan(target, rendered, force) {
  const entries = [...rendered.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const plan = [];
  for (const [relative, content] of entries) {
    const destination = joinTarget(target, relative);
    let reason = routeError(target, relative);
    let action;
    if (reason) {
      action = 'collision';
    } else if (isSymlink(destination)) {
      action = 'collision';
      reason = 'destination is a symlink';
    } else if (!exists(destination)) {
      action = 'create';
    } else if (!isFile(destination)) {
      action = 'collision';
      reason = 'destination is not a regular file';
    } else if (hardLinkCount(destination) > 1) {
      action = 'collision';
      reason = 'destination has multiple hard links';
    } else {
      const existing = readUtf8OrNull(destination);
      const matches = existing !== null && existing === content;
      action = matches ? 'unchanged' : force ? 'replace' : 'collision';
      if (action === 'collision') {
        reason = 'destination has different content';
      }
    }
    plan.push(new PlannedFile(relative, content, action, null, reason));
  }

  const reserved = new Set();
  const destinations = [...rendered.keys()];
  const withBackups = [];
  for (const item of plan) {
    if (item.action !== 'replace') {
      withBackups.push(item);
      continue;
    }
    let [backup, selectionError] = nextBackupPath(target, item.relativePath, reserved);
    if (
      destinations.some(
        (destination) =>
          backup === destination || isAncestor(backup, destination) || isAncestor(destination, backup),
      )
    ) {
      selectionError = 'conflicts with a planned destination';
    }
    if ([...reserved].some((previous) => isAncestor(backup, previous) || isAncestor(previous, backup))) {
      selectionError = 'conflicts with another planned backup';
    }
    reserved.add(backup);
    const reason = selectionError || routeError(target, backup);
    const backupDestination = joinTarget(target, backup);
    if (reason) {
      withBackups.push(new PlannedFile(item.relativePath, item.content, 'collision', backup, `backup ${reason}`));
    } else if (exists(backupDestination) || isSymlink(backupDestination)) {
      withBackups.push(
        new PlannedFile(item.relativePath, item.content, 'collision', backup, 'backup path is occupied'),
      );
    } else {
      withBackups.push(new PlannedFile(item.relativePath, item.content, item.action, backup));
    }
  }
  return withBackups;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

function copyPreservingTimes(source, destination) {
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const info = fs.statSync(source);
  fs.utimesSync(destination, info.atime, info.mtime);
}

function applyPlan(target, plan, dryRun) {
  const collisions = plan.filter((item) => item.action === 'collision');
  for (const item of plan) {
    const detail = item.reason ? ` (${item.reason})` : '';
    process.stdout.write(`${item.action.padEnd(9)} ${item.relativePath}${detail}\n`);
  }
  if (collisions.length > 0) {
    process.stderr.write('Installation aborted before writes: resolve collisions or explicitly use --force.\n');
    return 2;
  }
  if (dryRun) {
    return 0;
  }

  for (const item of plan) {
    if (item.action !== 'replace') {
      continue;
    }
    if (item.backupPath === null) {
      throw new Error(`Missing preflighted backup for ${item.relativePath}`);
    }
    const source = joinTarget(target, item.relativePath);
    const backup = joinTarget(target, item.backupPath);
    const sourceError = routeError(target, item.relativePath);
    const backupError = routeError(target, item.backupPath);
    if (
      sourceError ||
      isSymlink(source) ||
      !isFile(source) ||
      hardLinkCount(source) > 1 ||
      backupError ||
      exists(backup) ||
      isSymlink(backup)
    ) {
      throw new Error(`Filesystem changed after preflight for ${item.relativePath}`);
    }
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    copyPreservingTimes(source, backup);
    process.stdout.write(`backup    ${item.backupPath}\n`);
  }

  for (const item of plan) {
    const destination = joinTarget(target, item.relativePath);
    if (item.action === 'unchanged') {
      continue;
    }
    const destinationError = routeError(target, item.relativePath);
    if (
      destinationError ||
      isSymlink(destination) ||
      (exists(destination) && (!isFile(destination) || hardLinkCount(destination) > 1))
    ) {
      throw new Error(`Filesystem changed after preflight for ${item.relativePath}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, item.content, 'utf8');
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Argument parsing (argparse-compatible surface)
// ---------------------------------------------------------------------------

const PROG = 'install_harness.js';
const USAGE = `usage: ${PROG} [-h] [--target TARGET] [--platform {codex,claude,cursor}] [--project-name PROJECT_NAME] [--dry-run] [--force]`;
const HELP = `${USAGE}

${DESCRIPTION}

options:
  -h, --help            show this help message and exit
  --target TARGET
  --platform {codex,claude,cursor}
                        Adapter to install; repeat for multiple platforms (default: codex).
  --project-name PROJECT_NAME
                        Value for the generated consumer configuration.
  --dry-run             Print the complete plan without writing.
  --force               Replace divergent files after backing them up. Requires explicit authorization.
`;

class UsageError extends Error {}

class HelpRequested extends Error {}

function parseArgs(argv) {
  const args = { target: process.cwd(), platforms: null, projectName: null, dryRun: false, force: false };
  const valueFlags = {
    '--target': 'target',
    '--platform': 'platforms',
    '--project-name': 'projectName',
  };
  const tokens = [...argv];
  let index = 0;
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
    if (flag === '--dry-run' || flag === '--force') {
      if (inlineValue !== null) {
        throw new UsageError(`argument ${flag}: ignored explicit argument '${inlineValue}'`);
      }
      args[flag === '--dry-run' ? 'dryRun' : 'force'] = true;
      index += 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(valueFlags, flag)) {
      const value = inlineValue !== null ? inlineValue : nextValue(flag);
      if (flag === '--platform') {
        if (!PLATFORMS.includes(value)) {
          throw new UsageError(
            `argument --platform: invalid choice: '${value}' (choose from ${PLATFORMS.join(', ')})`,
          );
        }
        args.platforms = [...(args.platforms || []), value];
      } else {
        args[valueFlags[flag]] = value;
      }
      index += 1;
      continue;
    }
    if (token.startsWith('-') && token !== '-') {
      throw new UsageError(`unrecognized arguments: ${tokens.slice(index).join(' ')}`);
    }
    throw new UsageError(`unrecognized arguments: ${tokens.slice(index).join(' ')}`);
  }
  return args;
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
  const target = path.resolve(args.target);
  const platforms = args.platforms || ['codex'];
  const projectName = args.projectName || path.basename(target);
  const rendered = templateFiles(platforms, projectName);
  const plan = buildPlan(target, rendered, args.force);
  return applyPlan(target, plan, args.dryRun);
}

module.exports = {
  SKILL_ROOT,
  TEMPLATE_ROOT,
  PLATFORMS,
  RUNTIME_FILES,
  PlannedFile,
  templateFiles,
  routeError,
  nextBackupPath,
  buildPlan,
  applyPlan,
  parseArgs,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
