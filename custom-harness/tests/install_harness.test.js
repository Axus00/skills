'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const SCRIPT_PATH = path.resolve(__dirname, '..', 'scripts', 'install_harness.js');
const INSTALLER = require(SCRIPT_PATH);

function withTemporaryDirectory(callback) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-harness-install-'));
  try {
    return callback(temporary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function read(target) {
  return fs.readFileSync(target, 'utf8');
}

function listDir(target) {
  return fs.readdirSync(target);
}

function quietly(callback) {
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    return callback();
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test('test_install_is_idempotent', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);

    assert.equal(0, quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex'])));
    const statusBefore = read(path.join(target, '.harness/task-status.json'));
    const plan = INSTALLER.buildPlan(target, INSTALLER.templateFiles(['codex'], path.basename(target)), false);

    assert.ok(plan.length > 0);
    assert.ok(plan.every((item) => item.action === 'unchanged'));
    assert.equal(0, quietly(() => INSTALLER.applyPlan(target, plan, false)));
    assert.equal(statusBefore, read(path.join(target, '.harness/task-status.json')));
  });
});

test('test_dry_run_writes_nothing', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'cursor', '--dry-run']));

    assert.equal(0, result);
    assert.deepEqual([], listDir(target));
  });
});

test('test_project_name_is_toml_escaped', () => {
  const rendered = INSTALLER.templateFiles(['cursor'], 'quoted "name"');

  assert.ok(rendered.get('.harness/config.toml').includes('project_name = "quoted \\"name\\""'));
});

test('test_collision_aborts_before_any_write', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'AGENTS.md'), '# Existing\n', 'utf8');

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex']));

    assert.equal(2, result);
    assert.equal('# Existing\n', read(path.join(target, 'AGENTS.md')));
    assert.equal(false, fs.existsSync(path.join(target, '.harness')));
  });
});

test('test_force_replacement_creates_backup', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'AGENTS.md'), '# Existing\n', 'utf8');

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex', '--force']));

    assert.equal(0, result);
    const backup = path.join(target, '.harness/backups/AGENTS.md.bak');
    assert.equal('# Existing\n', read(backup));
    assert.ok(read(path.join(target, 'AGENTS.md')).includes('# Custom Harness Dispatcher'));
  });
});

test('test_force_does_not_follow_symlinked_destination', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);
    const outside = path.join(temporary, 'outside.md');
    fs.writeFileSync(outside, '# Outside\n', 'utf8');
    fs.symlinkSync(outside, path.join(target, 'AGENTS.md'));

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex', '--force']));

    assert.equal(2, result);
    assert.equal('# Outside\n', read(outside));
    assert.equal(false, fs.existsSync(path.join(target, '.harness')));
  });
});

test('test_force_aborts_when_backups_directory_is_symlink', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    const outside = path.join(temporary, 'outside');
    fs.mkdirSync(target);
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(target, '.harness'));
    fs.symlinkSync(outside, path.join(target, '.harness/backups'), 'dir');
    fs.writeFileSync(path.join(target, 'AGENTS.md'), '# Existing\n', 'utf8');

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex', '--force']));

    assert.equal(2, result);
    assert.equal('# Existing\n', read(path.join(target, 'AGENTS.md')));
    assert.deepEqual([], listDir(outside));
    assert.equal(false, fs.existsSync(path.join(target, '.agents')));
    assert.equal(false, fs.existsSync(path.join(target, '.harness/config.toml')));
  });
});

test('test_force_aborts_when_nested_backup_ancestor_is_symlink', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    const outside = path.join(temporary, 'outside');
    fs.mkdirSync(target);
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(target, '.harness/backups'), { recursive: true });
    fs.symlinkSync(outside, path.join(target, '.harness/backups/.codex'), 'dir');
    fs.mkdirSync(path.join(target, '.codex/agents'), { recursive: true });
    const role = path.join(target, '.codex/agents/leader.toml');
    fs.writeFileSync(role, 'name = "existing"\n', 'utf8');

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex', '--force']));

    assert.equal(2, result);
    assert.equal('name = "existing"\n', read(role));
    assert.deepEqual([], listDir(outside));
    assert.equal(false, fs.existsSync(path.join(target, 'AGENTS.md')));
    assert.equal(false, fs.existsSync(path.join(target, '.harness/config.toml')));
  });
});

test('test_force_preflights_non_directory_backup_path_before_writes', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);
    fs.mkdirSync(path.join(target, '.harness'));
    fs.writeFileSync(path.join(target, '.harness/backups'), 'occupied\n', 'utf8');
    fs.writeFileSync(path.join(target, 'AGENTS.md'), '# Existing\n', 'utf8');

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex', '--force']));

    assert.equal(2, result);
    assert.equal('# Existing\n', read(path.join(target, 'AGENTS.md')));
    assert.equal('occupied\n', read(path.join(target, '.harness/backups')));
    assert.equal(false, fs.existsSync(path.join(target, '.agents')));
    assert.equal(false, fs.existsSync(path.join(target, '.harness/config.toml')));
  });
});

test('test_backup_cannot_overlap_a_planned_destination', () => {
  withTemporaryDirectory((temporary) => {
    const target = temporary;
    const source = path.join(target, 'source.txt');
    fs.writeFileSync(source, 'existing\n', 'utf8');
    const backupDestination = '.harness/backups/source.txt.bak';
    const rendered = new Map([
      ['source.txt', 'replacement\n'],
      [backupDestination, 'planned content\n'],
    ]);

    const plan = INSTALLER.buildPlan(target, rendered, true);
    const result = quietly(() => INSTALLER.applyPlan(target, plan, false));

    assert.equal(2, result);
    assert.equal('existing\n', read(source));
    assert.equal(false, fs.existsSync(path.join(target, '.harness')));
  });
});

test('test_target_symlink_is_rejected', () => {
  withTemporaryDirectory((temporary) => {
    const outside = path.join(temporary, 'outside');
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, target, 'dir');

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'cursor']));

    assert.equal(2, result);
    assert.deepEqual([], listDir(outside));
  });
});

test('test_force_rejects_hardlinked_destination_without_mutation', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    const outside = path.join(temporary, 'outside.md');
    fs.mkdirSync(target);
    fs.writeFileSync(outside, '# Shared inode\n', 'utf8');
    const destination = path.join(target, 'AGENTS.md');
    fs.linkSync(outside, destination);
    const inode = fs.statSync(outside).ino;

    const result = quietly(() => INSTALLER.main(['--target', target, '--platform', 'codex', '--force']));

    assert.equal(2, result);
    assert.equal('# Shared inode\n', read(outside));
    assert.equal('# Shared inode\n', read(destination));
    assert.equal(inode, fs.statSync(outside).ino);
    assert.equal(inode, fs.statSync(destination).ino);
    assert.equal(false, fs.existsSync(path.join(target, '.agents')));
    assert.equal(false, fs.existsSync(path.join(target, '.harness')));
  });
});
