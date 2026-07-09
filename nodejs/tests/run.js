#!/usr/bin/env node
/**
 * @fileoverview Lightweight test runner for the agent CLI test suite.
 * Provides describe/it/assert for test files to use.
 * No external dependencies required.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);

// Export test framework for test files
global.describe = null;
global.it = null;
global.assert = null;

const allTests = [];
let currentSuite = '';

/**
 * Register a test suite.
 * @param {string} name - Suite name
 * @param {Function} fn - Suite definition function
 */
function describe(name, fn) {
  const prevSuite = currentSuite;
  currentSuite = name;
  fn();
  currentSuite = prevSuite;
}

/**
 * Register an individual test.
 * @param {string} name - Test name
 * @param {Function} fn - Test function
 */
function it(name, fn) {
  allTests.push({ suite: currentSuite, name, fn });
}

const assert = {
  strictEqual(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  deepStrictEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
      throw new Error(msg || `Expected ${e}, got ${a}`);
    }
  },
  ok(value, msg) {
    if (!value) throw new Error(msg || 'Expected truthy value');
  },
  match(text, regex, msg) {
    if (!regex.test(text)) throw new Error(msg || `Expected "${text}" to match ${regex}`);
  },
  notMatch(text, regex, msg) {
    if (regex.test(text)) throw new Error(msg || `Expected "${text}" to NOT match ${regex}`);
  },
  throws(fn, expectedMsg) {
    try { fn(); throw new Error('Expected error but none thrown'); }
    catch (e) {
      if (expectedMsg !== undefined && !e.message.includes(expectedMsg)) {
        throw new Error(`Expected error message "${expectedMsg}", got "${e.message}"`);
      }
    }
  }
};

// Inject into global scope so test files can use them
global.describe = describe;
global.it = it;
global.assert = assert;

// Load and run all test files
const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'))
  .sort();

console.log(`\n  agent-cli test suite\n${'─'.repeat(50)}\n`);

let total = 0;
let passed = 0;
let failed = 0;
const failures = [];

const start = Date.now();

(async () => {
for (const file of testFiles) {
  const filePath = path.join(testDir, file);
  const label = file.replace(/^test-/, '').replace(/\\.js$/, '');
  console.log(`  [${label}]\n`);

  try {
    // Clear tests from previous file
    allTests.length = 0;
    require(filePath);

    // Run tests from this file
    for (const { suite, name, fn } of allTests) {
      total++;
      try {
        const result = fn();
        // Handle async tests (return a Promise)
        if (result && typeof result.then === 'function') {
          await result;
        }
        passed++;
        console.log(`  ✓ ${name}`);
      } catch (e) {
        failed++;
        failures.push({ suite, name, error: e.message });
        console.log(`  ✗ ${name}: ${e.message}`);
      }
    }
  } catch (e) {
    failed++;
    failures.push({ suite: label, name: '(load error)', error: e.message });
    console.log(`  ✗ (load error): ${e.message}`);
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(2);
console.log(`\n${'─'.repeat(50)}`);
console.log(`  Result: ${passed}/${total} passed, ${failed} failed  (${elapsed}s)`);

if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach(f => console.log(`    • ${f.suite} > ${f.name}: ${f.error}`));
  process.exit(1);
}
process.exit(0);
})();
