---
name: testing
description: "Test patterns and conventions for this project"
tags: [testing, javascript, nodejs]
---

# Testing Guide

## Running Tests
```bash
npm test                    # run all 88+ tests
node --experimental-vm-modules tests/run.js   # direct runner
npm run test:watch          # watch mode
```

Test runner at `tests/run.js` — custom runner that discovers `test-*.js` files.

## Writing Tests
- One test file per source module: `tests/test-<name>.js`
- Use Node.js `assert` module (no external test frameworks required)
- Test files export each test as an async function or a synchronous function
- Use `describe` and `it` style via the test runner's conventions

## Test Coverage
- All tool parsers must be tested: XML format, JSON format, longcat format
- Error cases: invalid params, missing files, malformed JSON, boundary values
- Edge cases: empty strings, special characters, Unicode, very long inputs
- Platform-specific: test both Unix and Windows paths where applicable

## Test Structure Pattern
```javascript
const assert = require('assert');

async function testFeature() {
    const { ToolParser } = require('../src/core/agent');
    const calls = ToolParser.parse('<tool>read_file</tool><params>{"path":"test.txt"}</params>');
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].tool, 'read_file');
    assert.strictEqual(calls[0].params.path, 'test.txt');
    console.log('✓ testFeature');
}
```

## Before Committing
1. Run `npm test` — all tests must pass (zero failures)
2. Check no `.only()` or focused tests remain
3. Don't break existing tests when adding new features
