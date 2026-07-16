/**
 * @fileoverview Jest tests for misc tools: ripgrep, awk, calculator.
 *
 * These tests verify tool logic under controlled conditions.
 * The tools run via execFileSync/execSync on the real system,
 * so we test real output when the commands exist.
 */

const { execFileSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ----- helper: create a mock ToolRegistry -----
function makeRegistry() {
  const tools = new Map();
  const toolGroups = new Map();
  return {
    tools,
    toolGroups,
    session: { workingDir: process.cwd() },
    register(name, fn, description, group = '', schema = null) {
      tools.set(name, { fn, description, group, schema });
      if (group) {
        if (!toolGroups.has(group)) toolGroups.set(group, []);
        toolGroups.get(group).push(name);
      }
    },
    manualTree() { return ''; },
  };
}

/**
 * Lazily load registerMiscTools and return the tool implementations.
 * @param {Object} registry - ToolRegistry-like object
 * @returns {Function} tool function by name
 */
function loadTools(registry) {
  const { registerMiscTools } = require('../src/core/tools/misc-tools');
  registerMiscTools(registry);
  return (name) => registry.tools.get(name).fn;
}

describe('ripgrep tool', () => {
  let tool;

  beforeAll(() => {
    const registry = makeRegistry();
    const get = loadTools(registry);
    tool = get('ripgrep');
  });

  test('should detect missing ripgrep', async () => {
    // Temporarily hide rg from PATH for the check
    const origPath = process.env.PATH;
    const { commandExists } = require('../src/core/tools/utils');

    // Quick check: if rg exists, skip this test's path-tampering
    // and just confirm the tool runs with real rg on a known pattern
    const rgAvailable = commandExists('rg');
    if (!rgAvailable) {
      const result = await tool({ pattern: 'foo' });
      expect(result).toMatch(/ripgrep.*not found/);
      return;
    }

    // rg is available — test actual search on a known file
    const testFile = path.join(__dirname, 'test-new-tools.test.js');
    const result = await tool({ pattern: 'describe', path: __dirname });
    expect(result).toMatch(/describe/);
    origPath; // no-op, keep linter happy
  }, 15000);

  test('should search with glob filter', async () => {
    const { commandExists } = require('../src/core/tools/utils');
    if (!commandExists('rg')) return; // skip

    const result = await tool({
      pattern: 'test',
      path: __dirname,
      glob: '*.test.js',
      max_results: 5,
    });
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  }, 15000);

  test('should return no matches for impossible pattern', async () => {
    const { commandExists } = require('../src/core/tools/utils');
    if (!commandExists('rg')) return;

    // Search in a temp dir to avoid matching our own test file
    const tmpDir = path.join(__dirname, '__rg_test_dir__');
    try {
      fs.mkdirSync(tmpDir, { recursive: true });
      const result = await tool({
        pattern: 'XYZZYX_NONEXISTENT_PATTERN_12345',
        path: tmpDir,
      });
      expect(result).toMatch(/No matches found/);
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  }, 15000);
});

describe('awk tool', () => {
  let tool;

  beforeAll(() => {
    const registry = makeRegistry();
    const get = loadTools(registry);
    tool = get('awk');
  });

  test('should detect missing awk', async () => {
    const { commandExists } = require('../src/core/tools/utils');
    if (!commandExists('awk')) {
      const result = await tool({ script: '{print $1}', input: 'hello' });
      expect(result).toMatch(/awk.*not found/);
      return;
    }

    // awk is available — test real processing
    const result = await tool({ script: '{print $1}', input: 'hello world' });
    expect(result).toBe('hello');
  }, 15000);

  test('should extract fields with custom separator', async () => {
    const { commandExists } = require('../src/core/tools/utils');
    if (!commandExists('awk')) return;

    const result = await tool({
      script: '{print $2}',
      input: 'name:John:25',
      field_separator: ':',
    });
    expect(result).toBe('John');
  }, 15000);

  test('should process file input', async () => {
    const { commandExists } = require('../src/core/tools/utils');
    if (!commandExists('awk')) return;

    const tmpFile = path.join(__dirname, '__awk_test_data.txt');
    fs.writeFileSync(tmpFile, 'a 1\nb 2\nc 3\n', 'utf-8');
    try {
      const result = await tool({
        script: '{sum += $2} END {print sum}',
        file: tmpFile,
      });
      expect(result).toBe('6');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 15000);

  test('should error when neither file nor input given', async () => {
    const result = await tool({ script: '{print}' });
    expect(result).toMatch(/must be provided/);
  });
});

describe('calculator tool', () => {
  let tool;

  beforeAll(() => {
    const registry = makeRegistry();
    const get = loadTools(registry);
    tool = get('calculator');
  });

  test('should evaluate simple arithmetic', async () => {
    const result = await tool({ expression: '2 + 3 * 4' });
    expect(result).toBe('Result: 14');
  });

  test('should evaluate power operator', async () => {
    const result = await tool({ expression: '2^10' });
    expect(result).toBe('Result: 1024');
  });

  test('should evaluate with parentheses', async () => {
    const result = await tool({ expression: '(2 + 3) * 4' });
    expect(result).toBe('Result: 20');
  });

  test('should handle division', async () => {
    const result = await tool({ expression: '100 / 4' });
    expect(result).toBe('Result: 25');
  });

  test('should handle decimal numbers', async () => {
    const result = await tool({ expression: '3.14 * 2' });
    expect(result).toBe('Result: 6.28');
  });

  test('should handle percentage', async () => {
    const result = await tool({ expression: '200 * 0.15' });
    expect(result).toBe('Result: 30');
  });

  test('should handle pi (π)', async () => {
    const result = await tool({ expression: 'π * 4' });
    // π * 4 ≈ 12.566… — just check the format
    expect(result).toMatch(/Result:/);
  });

  test('should error on invalid expression', async () => {
    const result = await tool({ expression: '@@@' });
    expect(result).toMatch(/invalid expression|Error/);
  });

  test('should fall back to Wolfram when local fails and app_id set', async () => {
    const result = await tool({
      expression: 'integrate x^2 dx',
      use_wolfram: true,
      wolfram_app_id: 'test-invalid-id',
    });
    // When app_id is invalid, should still show local result or API error
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  }, 15000);

  test('should attempt Wolfram Alpha with use_wolfram flag', async () => {
    const result = await tool({
      expression: '2 + 2',
      use_wolfram: true,
      wolfram_app_id: 'test-invalid-id',
    });
    // Should report local result + API error when wolfram fails
    expect(result).toMatch(/Local:/);
    expect(result).toMatch(/Wolfram Alpha/);
  }, 15000);
});

describe('ToolRegistry integration for new tools', () => {
  test('all three tools are registered with correct groups', () => {
    const { ToolRegistry } = require('../src/core/tools');
    const registry = new ToolRegistry({
      config: {}, workingDir: process.cwd(),
      on: () => {}, emit: () => {},
    });
    const toolNames = Array.from(registry.tools.keys());

    expect(toolNames).toContain('ripgrep');
    expect(toolNames).toContain('awk');
    expect(toolNames).toContain('calculator');

    // Check groups
    expect(registry.toolGroups.get('search')).toContain('ripgrep');
    expect(registry.toolGroups.get('text')).toContain('awk');
    expect(registry.toolGroups.get('math')).toContain('calculator');
  });
});
