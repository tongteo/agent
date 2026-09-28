const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerFileOps } = require('../src/core/tools/file-ops');

function makeTools(workingDir) {
  const tools = new Map();
  registerFileOps({
    session: { workingDir },
    register(name, fn) { tools.set(name, fn); },
  });
  return tools;
}

async function withWorkspace(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-file-ops-'));
  const workspace = path.join(tempRoot, 'workspace');
  const outside = path.join(tempRoot, 'outside');
  fs.mkdirSync(workspace);
  fs.mkdirSync(outside);
  try {
    return await run({ tempRoot, workspace, outside });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

describe('Workspace-scoped filesystem tools', () => {
  it('reads a file within the current workspace', async () => {
    await withWorkspace(async ({ workspace }) => {
      fs.writeFileSync(path.join(workspace, 'inside.txt'), 'hello');
      const tools = makeTools(workspace);
      assert.strictEqual(await tools.get('read_file')({ path: 'inside.txt' }), 'hello');
    });
  });

  it('blocks traversal outside the workspace for all read/search tools', async () => {
    await withWorkspace(async ({ workspace, outside }) => {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
      const tools = makeTools(workspace);
      const attempts = [
        tools.get('read_file')({ path: '../outside/secret.txt' }),
        tools.get('read_lines')({ path: '../outside/secret.txt', start: 1, end: 1 }),
        tools.get('list_dir')({ path: '../outside' }),
        tools.get('grep')({ pattern: 'private', path: '../outside' }),
        tools.get('find_files')({ pattern: '*', path: '../outside' }),
      ];
      const results = await Promise.all(attempts);
      for (const result of results) assert.match(result, /Path escapes sandbox/);
    });
  });

  it('blocks reads through symlinks that point outside the allowed workspace', async () => {
    await withWorkspace(async ({ workspace, outside }) => {
      fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
      fs.symlinkSync(outside, path.join(workspace, 'external'), 'dir');
      const tools = makeTools(workspace);
      const result = await tools.get('read_file')({ path: 'external/secret.txt' });
      assert.match(result, /Path escapes sandbox through a symlink/);
    });
  });
});
