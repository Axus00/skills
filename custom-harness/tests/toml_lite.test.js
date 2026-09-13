'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');

const { parse, TomlError } = require(path.resolve(__dirname, '..', 'scripts', 'toml_lite.js'));

test('test_multiline_basic_string_trims_leading_newline', () => {
  const data = parse('name = "leader"\ntext = """\nfirst line\nsecond "quoted" line\n"""\n');

  assert.equal(data.name, 'leader');
  assert.equal(data.text, 'first line\nsecond "quoted" line\n');
});

test('test_basic_string_escapes_and_literal_strings', () => {
  const data = parse('a = "tab\\tquote\\" backslash\\\\ unicode\\u00e9"\nb = \'C:\\path\\n\'\n');

  assert.equal(data.a, 'tab\tquote" backslash\\ unicode\u00e9');
  assert.equal(data.b, 'C:\\path\\n');
});

test('test_arrays_allow_multiline_and_trailing_comma', () => {
  const data = parse('labels = [\n  "security", # comment\n  "release",\n]\nnumbers = [1, 2, 3]\nempty = []\n');

  assert.deepEqual(data.labels, ['security', 'release']);
  assert.deepEqual(data.numbers, [1, 2, 3]);
  assert.deepEqual(data.empty, []);
});

test('test_tables_scalars_and_comments', () => {
  const data = parse(
    '# top comment\nschema_version = 1\nenabled = true\n\n[classification]\nsmall_max_files = 3 # trailing\nnegative = -7\n\n[policy]\nallow_commits = false\n',
  );

  assert.deepEqual(data, {
    schema_version: 1,
    enabled: true,
    classification: { small_max_files: 3, negative: -7 },
    policy: { allow_commits: false },
  });
});

test('test_duplicate_key_is_an_error', () => {
  assert.throws(() => parse('name = "a"\nname = "b"\n'), TomlError);
  assert.throws(() => parse('[t]\nx = 1\n[t]\ny = 2\n'), TomlError);
});

test('test_invalid_syntax_is_an_error', () => {
  assert.throws(() => parse('garbage\n'), TomlError);
  assert.throws(() => parse('name = "unterminated\n'), TomlError);
  assert.throws(() => parse('name = "a" trailing\n'), TomlError);
  assert.throws(() => parse('[open\nx = 1\n'), TomlError);
  const error = (() => {
    try {
      parse('x = nope\n');
      return null;
    } catch (caught) {
      return caught;
    }
  })();
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'TomlError');
});
