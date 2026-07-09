/**
 * @fileoverview Tests for SkillManager — skills CRUD, search, and prompt injection.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { SkillManager } = require('../src/core/skills');

const TEST_SKILLS_DIR = path.join(os.tmpdir(), 'test-skills-' + Date.now());

describe('SkillManager', () => {
  function freshSM() {
    try { fs.rmSync(TEST_SKILLS_DIR, { recursive: true, force: true }); } catch {}
    return new SkillManager(TEST_SKILLS_DIR);
  }

  it('creates skills directory on init', () => {
    const sm = freshSM();
    assert.ok(fs.existsSync(TEST_SKILLS_DIR));
  });

  it('list() returns empty for fresh dir', () => {
    const sm = freshSM();
    assert.deepStrictEqual(sm.list(), []);
  });

  it('create() adds a new skill file', () => {
    const sm = freshSM();
    const result = sm.create('my-skill', 'Do this thing', 'A test skill', ['test', 'demo']);
    assert.ok(result.success);

    const all = sm.list();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].name, 'my-skill');
    assert.strictEqual(all[0].description, 'A test skill');
    assert.deepStrictEqual(all[0].tags, ['test', 'demo']);
  });

  it('create() rejects duplicate names', () => {
    const sm = freshSM();
    sm.create('dup', 'content', 'desc');
    const result = sm.create('dup', 'other');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('already exists'));
  });

  it('view() returns skill by exact name', () => {
    const sm = freshSM();
    sm.create('test-skill', '# Content\n\nSome instructions');
    const skill = sm.view('test-skill');
    assert.ok(skill);
    assert.strictEqual(skill.name, 'test-skill');
    assert.ok(skill.body.includes('Some instructions'));
  });

  it('view() returns skill case-insensitively', () => {
    const sm = freshSM();
    sm.create('MySkill', 'body');
    const skill = sm.view('myskill');
    assert.ok(skill);
  });

  it('view() returns null for missing skill', () => {
    const sm = freshSM();
    assert.strictEqual(sm.view('nope'), null);
  });

  it('load() activates a skill', () => {
    const sm = freshSM();
    sm.create('loaded-skill', '# Important Rules\n\nFollow these.');
    const result = sm.load('loaded-skill');
    assert.ok(result.success);
    assert.ok(sm.isLoaded('loaded-skill'));
  });

  it('load() fails if already loaded', () => {
    const sm = freshSM();
    sm.create('double-load', 'content');
    sm.load('double-load');
    const result = sm.load('double-load');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('already loaded'));
  });

  it('load() fails for missing skill', () => {
    const sm = freshSM();
    const result = sm.load('ghost');
    assert.strictEqual(result.success, false);
  });

  it('getLoadedPromptAdditions() returns formatted string', () => {
    const sm = freshSM();
    sm.create('skill-a', '# Skill A\n\nDo X');
    sm.create('skill-b', '# Skill B\n\nDo Y');
    sm.load('skill-a');

    const additions = sm.getLoadedPromptAdditions();
    assert.ok(additions.includes('[Loaded Skills]'));
    assert.ok(additions.includes('Skill A'));
    assert.ok(!additions.includes('Skill B'));
  });

  it('getLoadedPromptAdditions() returns empty when none loaded', () => {
    const sm = freshSM();
    assert.strictEqual(sm.getLoadedPromptAdditions(), '');
  });

  it('edit() replaces skill content', () => {
    const sm = freshSM();
    sm.create('edit-me', 'Old content', 'old desc');
    sm.edit('edit-me', '---\nname: edit-me\n---\nNew content');
    const skill = sm.view('edit-me');
    assert.ok(skill.body.includes('New content'));
    assert.ok(!skill.body.includes('Old content'));
  });

  it('edit() fails for missing skill', () => {
    const sm = freshSM();
    const result = sm.edit('ghost', 'New content');
    assert.strictEqual(result.success, false);
  });

  it('patch() finds and replaces text', () => {
    const sm = freshSM();
    sm.create('patch-me', '# Title\n\nOld text here', 'desc');
    const result = sm.patch('patch-me', 'Old text', 'New text');
    assert.ok(result.success);
    const skill = sm.view('patch-me');
    assert.ok(skill.body.includes('New text'));
  });

  it('patch() fails if old_str not found', () => {
    const sm = freshSM();
    sm.create('patch-fail', '# Content');
    const result = sm.patch('patch-fail', 'nonexistent', 'x');
    assert.strictEqual(result.success, false);
  });

  it('delete() removes skill file', () => {
    const sm = freshSM();
    sm.create('delete-me', 'bye');
    assert.strictEqual(sm.list().length, 1);
    const result = sm.delete('delete-me');
    assert.ok(result.success);
    assert.strictEqual(sm.list().length, 0);
  });

  it('delete() fails for missing skill', () => {
    const sm = freshSM();
    const result = sm.delete('ghost');
    assert.strictEqual(result.success, false);
  });

  it('search() finds skills by keyword', () => {
    const sm = freshSM();
    sm.create('sorting', 'Implement quicksort algorithm', 'Sorting algorithms', ['algo', 'sort']);
    sm.create('networking', 'HTTP requests and sockets', 'Network programming', ['http']);

    const results = sm.search('sort');
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].name, 'sorting');
  });

  it('search() returns empty for no matches', () => {
    const sm = freshSM();
    sm.create('unique-name', 'content');
    const results = sm.search('zzz_nonexistent');
    assert.deepStrictEqual(results, []);
  });

  it('search() handles empty query', () => {
    const sm = freshSM();
    assert.deepStrictEqual(sm.search(''), []);
    assert.deepStrictEqual(sm.search('   '), []);
  });

  it('refresh() re-scans directory', () => {
    const sm = freshSM();
    sm.create('before-scan', 'content');
    fs.writeFileSync(path.join(TEST_SKILLS_DIR, 'manual-skill.md'), '---\nname: manual-skill\n---\nManual body');
    sm.refresh();
    const manual = sm.view('manual-skill');
    assert.ok(manual);
  });

  it('load() injects body into prompt additions', () => {
    const sm = freshSM();
    sm.create('code-rules', 'Always use 2-space indent.');
    sm.load('code-rules');
    const additions = sm.getLoadedPromptAdditions();
    assert.ok(additions.includes('Always use 2-space indent.'));
    assert.ok(additions.includes('=== Skill: code-rules ==='));
  });

  it('parses YAML frontmatter from file', () => {
    const sm = freshSM();
    fs.writeFileSync(path.join(TEST_SKILLS_DIR, 'with-fm.md'),
      '---\nname: with-fm\ndescription: "Has frontmatter"\ntags: [a, b, c]\n---\n\nBody content here');
    sm.refresh();
    const skill = sm.view('with-fm');
    assert.ok(skill);
    assert.strictEqual(skill.description, 'Has frontmatter');
    assert.deepStrictEqual(skill.tags, ['a', 'b', 'c']);
    assert.ok(skill.body.includes('Body content'));
  });

  it('handles file with no frontmatter', () => {
    const sm = freshSM();
    fs.writeFileSync(path.join(TEST_SKILLS_DIR, 'no-fm.md'), 'Just body text');
    sm.refresh();
    const skill = sm.view('no-fm');
    assert.ok(skill);
    assert.strictEqual(skill.name, 'no-fm');
    assert.strictEqual(skill.description, '');
    assert.strictEqual(skill.body, 'Just body text');
  });

  it('getLoadedSkillNames() returns loaded names', () => {
    const sm = freshSM();
    sm.create('a', 'body');
    sm.create('b', 'body');
    sm.load('a');
    assert.deepStrictEqual(sm.getLoadedSkillNames(), ['a']);
  });
});
