#!/usr/bin/env node
'use strict';
/**
 * Minimal dependency-free TOML parser for Custom Harness agent and config files.
 *
 * Supported subset: comments, bare keys, basic strings with escapes, multi-line
 * basic strings, literal strings, integers, booleans, arrays of scalars
 * (multi-line, trailing comma allowed), and [table] headers.
 */

class TomlError extends Error {
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'TomlError';
    this.line = line;
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const INTEGER = /^[+-]?(?:0|[1-9](?:_?[0-9])*)$/;
const FLOAT = /^[+-]?(?:[0-9](?:_?[0-9])*)(?:\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;

class Parser {
  constructor(source) {
    this.source = source;
    this.position = 0;
    this.line = 1;
    this.root = {};
    this.current = this.root;
    this.definedTables = new Set();
  }

  fail(message) {
    throw new TomlError(message, this.line);
  }

  peek(offset = 0) {
    return this.source[this.position + offset];
  }

  eof() {
    return this.position >= this.source.length;
  }

  advance(count = 1) {
    for (let index = 0; index < count; index += 1) {
      if (this.source[this.position] === '\n') {
        this.line += 1;
      }
      this.position += 1;
    }
  }

  skipInlineWhitespace() {
    while (!this.eof() && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
    }
  }

  skipComment() {
    if (this.peek() === '#') {
      while (!this.eof() && this.peek() !== '\n') {
        this.advance();
      }
    }
  }

  skipWhitespaceAndComments() {
    for (;;) {
      this.skipInlineWhitespace();
      this.skipComment();
      if (this.peek() === '\n' || this.peek() === '\r') {
        this.advance();
        continue;
      }
      return;
    }
  }

  expectEndOfLine() {
    this.skipInlineWhitespace();
    this.skipComment();
    if (this.eof()) {
      return;
    }
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.advance(2);
      return;
    }
    if (this.peek() === '\n') {
      this.advance();
      return;
    }
    this.fail(`Unexpected content after value: ${JSON.stringify(this.peek())}`);
  }

  parse() {
    for (;;) {
      this.skipWhitespaceAndComments();
      if (this.eof()) {
        return this.root;
      }
      if (this.peek() === '[') {
        this.parseTableHeader();
      } else {
        this.parseKeyValue(this.current);
      }
      this.expectEndOfLine();
    }
  }

  parseTableHeader() {
    if (this.peek(1) === '[') {
      this.fail('Arrays of tables are not supported');
    }
    this.advance();
    this.skipInlineWhitespace();
    const key = this.parseKey();
    this.skipInlineWhitespace();
    if (this.peek() !== ']') {
      this.fail('Expected "]" to close table header');
    }
    this.advance();
    if (this.definedTables.has(key)) {
      this.fail(`Duplicate table: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(this.root, key)) {
      this.fail(`Key already defined: ${key}`);
    }
    this.definedTables.add(key);
    const table = {};
    this.root[key] = table;
    this.current = table;
  }

  parseKey() {
    const character = this.peek();
    if (character === '"') {
      return this.parseBasicString();
    }
    if (character === "'") {
      return this.parseLiteralString();
    }
    let key = '';
    while (!this.eof() && /[A-Za-z0-9_-]/.test(this.peek())) {
      key += this.peek();
      this.advance();
    }
    if (!key || !BARE_KEY.test(key)) {
      this.fail('Invalid or missing key');
    }
    return key;
  }

  parseKeyValue(table) {
    const key = this.parseKey();
    this.skipInlineWhitespace();
    if (this.peek() === '.') {
      this.fail('Dotted keys are not supported');
    }
    if (this.peek() !== '=') {
      this.fail(`Expected "=" after key ${key}`);
    }
    this.advance();
    this.skipInlineWhitespace();
    const value = this.parseValue();
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      this.fail(`Duplicate key: ${key}`);
    }
    table[key] = value;
  }

  parseValue() {
    if (this.eof()) {
      this.fail('Expected a value');
    }
    const character = this.peek();
    if (character === '"') {
      if (this.peek(1) === '"' && this.peek(2) === '"') {
        return this.parseMultilineBasicString();
      }
      return this.parseBasicString();
    }
    if (character === "'") {
      if (this.peek(1) === "'" && this.peek(2) === "'") {
        return this.parseMultilineLiteralString();
      }
      return this.parseLiteralString();
    }
    if (character === '[') {
      return this.parseArray();
    }
    if (character === '{') {
      this.fail('Inline tables are not supported');
    }
    return this.parseBareValue();
  }

  parseBareValue() {
    let token = '';
    while (!this.eof() && /[A-Za-z0-9_+\-.:]/.test(this.peek())) {
      token += this.peek();
      this.advance();
    }
    if (token === 'true') {
      return true;
    }
    if (token === 'false') {
      return false;
    }
    if (INTEGER.test(token)) {
      return Number.parseInt(token.replace(/_/g, ''), 10);
    }
    if (token && FLOAT.test(token)) {
      return Number.parseFloat(token.replace(/_/g, ''));
    }
    this.fail(token ? `Invalid value: ${token}` : 'Expected a value');
    return undefined;
  }

  parseEscape() {
    // Positioned right after the backslash.
    const character = this.peek();
    this.advance();
    switch (character) {
      case 'b':
        return '\b';
      case 't':
        return '\t';
      case 'n':
        return '\n';
      case 'f':
        return '\f';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case '\\':
        return '\\';
      case 'u':
      case 'U': {
        const width = character === 'u' ? 4 : 8;
        const hex = this.source.slice(this.position, this.position + width);
        if (!/^[0-9A-Fa-f]+$/.test(hex) || hex.length !== width) {
          this.fail('Invalid unicode escape');
        }
        this.advance(width);
        const codePoint = Number.parseInt(hex, 16);
        if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
          this.fail('Invalid unicode escape');
        }
        return String.fromCodePoint(codePoint);
      }
      default:
        this.fail(`Invalid escape sequence: \\${character === undefined ? '' : character}`);
        return '';
    }
  }

  parseBasicString() {
    this.advance();
    let value = '';
    for (;;) {
      if (this.eof() || this.peek() === '\n') {
        this.fail('Unterminated string');
      }
      const character = this.peek();
      if (character === '"') {
        this.advance();
        return value;
      }
      if (character === '\\') {
        this.advance();
        value += this.parseEscape();
        continue;
      }
      value += character;
      this.advance();
    }
  }

  parseMultilineBasicString() {
    this.advance(3);
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.advance(2);
    } else if (this.peek() === '\n') {
      this.advance();
    }
    let value = '';
    for (;;) {
      if (this.eof()) {
        this.fail('Unterminated multi-line string');
      }
      const character = this.peek();
      if (character === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
        this.advance(3);
        // Up to two additional quotes may precede the closing delimiter.
        while (this.peek() === '"') {
          value += '"';
          this.advance();
        }
        return value;
      }
      if (character === '\\') {
        this.advance();
        const next = this.peek();
        if (next === '\n' || next === '\r' || next === ' ' || next === '\t') {
          // Line-ending backslash trims all whitespace up to the next non-blank.
          let sawNewline = false;
          while (!this.eof() && /[ \t\r\n]/.test(this.peek())) {
            if (this.peek() === '\n') {
              sawNewline = true;
            }
            this.advance();
          }
          if (!sawNewline) {
            this.fail('Invalid escape sequence: backslash followed by whitespace');
          }
          continue;
        }
        value += this.parseEscape();
        continue;
      }
      value += character;
      this.advance();
    }
  }

  parseLiteralString() {
    this.advance();
    let value = '';
    for (;;) {
      if (this.eof() || this.peek() === '\n') {
        this.fail('Unterminated string');
      }
      const character = this.peek();
      if (character === "'") {
        this.advance();
        return value;
      }
      value += character;
      this.advance();
    }
  }

  parseMultilineLiteralString() {
    this.advance(3);
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.advance(2);
    } else if (this.peek() === '\n') {
      this.advance();
    }
    let value = '';
    for (;;) {
      if (this.eof()) {
        this.fail('Unterminated multi-line string');
      }
      const character = this.peek();
      if (character === "'" && this.peek(1) === "'" && this.peek(2) === "'") {
        this.advance(3);
        while (this.peek() === "'") {
          value += "'";
          this.advance();
        }
        return value;
      }
      value += character;
      this.advance();
    }
  }

  parseArray() {
    this.advance();
    const values = [];
    for (;;) {
      this.skipWhitespaceAndComments();
      if (this.eof()) {
        this.fail('Unterminated array');
      }
      if (this.peek() === ']') {
        this.advance();
        return values;
      }
      if (this.peek() === '[') {
        this.fail('Nested arrays are not supported');
      }
      values.push(this.parseValue());
      this.skipWhitespaceAndComments();
      if (this.peek() === ',') {
        this.advance();
        continue;
      }
      if (this.peek() === ']') {
        this.advance();
        return values;
      }
      this.fail('Expected "," or "]" in array');
    }
  }
}

function parse(source) {
  if (typeof source !== 'string') {
    throw new TomlError('TOML source must be a string');
  }
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return new Parser(text).parse();
}

module.exports = { parse, TomlError };
