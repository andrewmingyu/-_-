import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('required host origins are not redundantly requested as optional', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve('newscheck 4/manifest.json'), 'utf8'));
  const required = new Set(manifest.host_permissions || []);
  for (const origin of manifest.optional_host_permissions || []) {
    assert.equal(required.has(origin), false, `${origin} is already a required host permission`);
  }
});

test('content-script dynamic imports and their dependencies are web accessible', () => {
  const root = path.resolve('newscheck 4');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
  const visited = new Set();
  const entries = [...content.matchAll(/chrome\.runtime\.getURL\(['"]([^'"]+)['"]\)/g)].map(m => m[1]);
  assert.ok(entries.length, 'Expected extension modules loaded by the content script');
  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    for (const entry of manifest.content_scripts) {
      for (const host of entry.matches) {
        assert.ok(manifest.web_accessible_resources.some(rule => rule.matches.includes(host) && rule.resources.includes(name)),
          `${name} is not declared web accessible for ${host}`);
      }
    }
    for (const match of source.matchAll(/(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"](\.[^'"]+)['"]/g)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
    }
  }
  entries.forEach(visit);
});
