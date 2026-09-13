'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const INSTALLER = require(path.join(ROOT, 'scripts', 'install_harness.js'));
const VALIDATOR = require(path.join(ROOT, 'scripts', 'validate_harness.js'));
const toml = require(path.join(ROOT, 'scripts', 'toml_lite.js'));

function withTemporaryDirectory(callback) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-harness-validate-'));
  try {
    return callback(temporary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
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

function install(target, ...platforms) {
  const args = ['--target', target];
  for (const platform of platforms) {
    args.push('--platform', platform);
  }
  assert.equal(0, quietly(() => INSTALLER.main(args)));
}

function read(target) {
  return fs.readFileSync(target, 'utf8');
}

function write(target, content) {
  fs.writeFileSync(target, content, 'utf8');
}

function assertSome(errors, needle) {
  assert.ok(
    errors.some((error) => error.includes(needle)),
    `expected an error containing ${JSON.stringify(needle)} in ${JSON.stringify(errors)}`,
  );
}

test('test_skill_source_is_valid', () => {
  assert.deepEqual([], VALIDATOR.validateSkill(ROOT));
});

test('test_all_installed_adapters_are_valid_end_to_end', () => {
  withTemporaryDirectory((temporary) => {
    const target = path.join(temporary, 'consumer');
    fs.mkdirSync(target);
    const platforms = ['codex', 'claude', 'cursor'];
    install(target, ...platforms);

    assert.deepEqual([], VALIDATOR.validateTarget(target, platforms));
    assert.equal(read(path.join(ROOT, 'scripts/workflow_state.js')), read(path.join(target, '.harness/bin/workflow_state.js')));
  });
});

test('test_codex_uses_real_toml_agents_and_discoverable_skill', () => {
  withTemporaryDirectory((target) => {
    install(target, 'codex');

    for (const role of ['leader', 'implementer', 'reviewer']) {
      const data = toml.parse(read(path.join(target, `.codex/agents/${role}.toml`)));
      assert.equal(role, data.name);
      assert.ok(data.description);
      assert.ok(data.developer_instructions);
      assert.equal(false, 'model' in data);
      assert.equal(false, fs.existsSync(path.join(target, `.agents/${role}.md`)));
    }
    assert.ok(fs.statSync(path.join(target, '.agents/skills/custom-harness/SKILL.md')).isFile());
  });
});

test('test_claude_uses_native_agents_and_discoverable_skill', () => {
  withTemporaryDirectory((target) => {
    install(target, 'claude');

    for (const role of ['leader', 'implementer', 'reviewer']) {
      const content = read(path.join(target, `.claude/agents/${role}.md`));
      const [metadata, errors] = VALIDATOR.frontmatter(content, role);
      assert.deepEqual([], errors);
      assert.equal(role, metadata.name);
    }
    assert.ok(fs.statSync(path.join(target, '.claude/skills/custom-harness/SKILL.md')).isFile());
  });
});

test('test_cursor_rule_requires_explicit_degraded_review_contract', () => {
  withTemporaryDirectory((target) => {
    install(target, 'cursor');
    const rule = path.join(target, '.cursor/rules/custom-harness.mdc');
    let content = read(rule);
    content = content.replace('Record `review-isolation:<reason>`', 'Record a limitation');
    content = content.replace('a `review-pass`, never an independent review', 'a review');
    write(rule, content);

    const errors = VALIDATOR.validateTarget(target, ['cursor']);

    assertSome(errors, 'degraded review');
    assertSome(errors, 'review pass label');
    assertSome(errors, 'independent warning');
  });
});

test('test_each_role_file_is_validated_in_its_native_format', () => {
  const cases = {
    codex: '.codex/agents/leader.toml',
    claude: '.claude/agents/leader.md',
  };
  for (const [platform, relative] of Object.entries(cases)) {
    withTemporaryDirectory((target) => {
      install(target, platform);
      write(path.join(target, relative), 'garbage\n');

      const errors = VALIDATOR.validateTarget(target, [platform]);

      assert.ok(
        errors.some((error) => ['invalid TOML', 'frontmatter'].some((needle) => error.includes(needle))),
        `${platform}: ${JSON.stringify(errors)}`,
      );
    });
  }
});

test('test_forbidden_state_clearing_and_percentage_checkpoint_are_rejected', () => {
  withTemporaryDirectory((target) => {
    install(target, 'codex');
    const dispatcher = path.join(target, 'AGENTS.md');
    write(dispatcher, `${read(dispatcher)}\nClear task-status.json after approval. Checkpoint near 40%.\n`);

    const errors = VALIDATOR.validateTarget(target, ['codex']);

    assertSome(errors, 'state clearing instruction');
    assertSome(errors, 'ambiguous percentage checkpoint');
  });
});

test('test_codex_obsolete_markdown_role_is_rejected', () => {
  withTemporaryDirectory((target) => {
    install(target, 'codex');
    write(path.join(target, '.agents/leader.md'), '# Legacy leader\n');

    const errors = VALIDATOR.validateTarget(target, ['codex']);

    assertSome(errors, 'obsolete role contract');
  });
});

test('test_nonempty_garbage_dispatcher_is_rejected_semantically', () => {
  const cases = {
    codex: 'AGENTS.md',
    claude: 'CLAUDE.md',
    cursor: '.cursor/rules/custom-harness.mdc',
  };
  for (const [platform, relative] of Object.entries(cases)) {
    withTemporaryDirectory((target) => {
      install(target, platform);
      write(path.join(target, relative), '# Garbage adapter\n');

      const errors = VALIDATOR.validateTarget(target, [platform]);

      assert.ok(
        errors.some((error) => error.includes('semantic invariant missing')),
        `${platform}: ${JSON.stringify(errors)}`,
      );
    });
  }
});

test('test_binary_adapter_is_rejected_without_crashing', () => {
  withTemporaryDirectory((target) => {
    install(target, 'cursor');
    fs.writeFileSync(path.join(target, '.cursor/rules/custom-harness.mdc'), Buffer.from([0xff, 0xfe, 0x00]));

    const errors = VALIDATOR.validateTarget(target, ['cursor']);

    assertSome(errors, 'not readable UTF-8');
  });
});

test('test_checkpoint_requires_observable_trigger_and_sequence_fields', () => {
  withTemporaryDirectory((target) => {
    install(target, 'cursor');
    write(path.join(target, '.harness/context/task-context.toon'), 'objective: "x"\n');

    const errors = VALIDATOR.validateTarget(target, ['cursor']);

    for (const field of ['trigger', 'phase', 'next_phase', 'state_sequence', 'actor_role', 'actor_id']) {
      assertSome(errors, `missing field: ${field}`);
    }
  });
});

test('test_task_status_requires_complete_v2_schema', () => {
  const errors = VALIDATOR.WORKFLOW.stateErrors({});

  for (const field of Object.keys(VALIDATOR.WORKFLOW.defaultState())) {
    assertSome(errors, `missing field: ${field}`);
  }
});

test('test_tampered_state_evidence_chain_is_rejected', () => {
  const state = VALIDATOR.WORKFLOW.defaultState();
  Object.assign(state, { task: 'x', branch: 'review', phase: 'initialized' });
  Object.assign(state.validation, { initialInitPassed: true, initialInitCommand: './init.sh' });
  state.evidence = [
    {
      sequence: 2,
      timestamp: '2026-01-01T00:00:00Z',
      branch: 'review',
      from: 'wrong',
      to: 'initialized',
      actorRole: 'leader',
      actorId: 'a',
      summary: 'bad',
    },
  ];

  const errors = VALIDATOR.WORKFLOW.stateErrors(state);

  assertSome(errors, 'sequence');
  assertSome(errors, 'chain');
  assertSome(errors, 'actor role');
});

test('test_state_engine_with_command_execution_primitive_is_rejected', () => {
  withTemporaryDirectory((temporary) => {
    const engine = path.join(temporary, 'workflow_state.js');
    write(engine, "const { spawnSync } = require('child_process');\nrequire('child_process').spawnSync('echo');\n");

    const errors = VALIDATOR.engineErrors(engine);

    assertSome(errors, 'must not import');
    assertSome(errors, 'must not execute');
  });
});

test('test_contract_without_project_context_gate_is_rejected', () => {
  withTemporaryDirectory((target) => {
    install(target, 'cursor');
    const contract = path.join(target, '.harness/contract.md');
    write(contract, read(contract).replace(/project context gate/gi, 'entry step'));

    const errors = VALIDATOR.validateTarget(target, ['cursor']);

    assertSome(errors, 'portable contract semantic invariant missing: project context gate');
  });
});

test('test_installed_target_requires_memanto_references', () => {
  withTemporaryDirectory((target) => {
    install(target, 'codex');
    fs.rmSync(path.join(target, '.harness/references/memanto.md'));
    write(path.join(target, '.harness/references/project-context.md'), '');

    const errors = VALIDATOR.validateTarget(target, ['codex']);

    assertSome(errors, 'missing or empty: .harness/references/memanto.md');
    assertSome(errors, 'missing or empty: .harness/references/project-context.md');
  });
});

test('test_engine_requiring_child_process_is_rejected', () => {
  withTemporaryDirectory((temporary) => {
    const engine = path.join(temporary, 'workflow_state.js');
    write(
      engine,
      [
        "'use strict';",
        "// require('child_process') in a comment must not count by itself",
        "const cp = require('node:child_process');",
        "cp.execSync('echo');",
        'module.exports = {};',
        '',
      ].join('\n'),
    );

    const errors = VALIDATOR.engineErrors(engine);

    assertSome(errors, 'workflow state engine must not import command execution modules');
    assertSome(errors, 'workflow state engine must not execute commands: execSync');
    assert.equal(1, errors.filter((error) => error.includes('must not import')).length);
  });
});
