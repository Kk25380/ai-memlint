// displayPath is the privacy boundary for anything that leaves the process: it is what
// turns an absolute path into `~`-relative before a report or the viewer payload is written.
// resolve() is the other half — it must keep derived data out of the code root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { DATA_ROOT, HOME, STORE, displayPath, resolve } from '../lib/paths.mjs';

test('displayPath collapses the home directory', () => {
  assert.equal(displayPath(HOME), '~');
  assert.equal(displayPath(HOME + sep + 'x'), '~' + sep + 'x');
});

test('displayPath leaves outside paths and non-strings alone', () => {
  assert.equal(displayPath('relative/thing'), 'relative/thing');
  assert.equal(displayPath(null), null);
  assert.equal(displayPath(undefined), undefined);
});

test('resolve reports the same roots the modules use', () => {
  const r = resolve();
  assert.equal(r.data, DATA_ROOT);
  assert.equal(r.store, STORE);
  assert.equal(r.overridden, Boolean(process.env.AI_MEMORY_HOME));
});
