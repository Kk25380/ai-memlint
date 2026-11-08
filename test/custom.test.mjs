// Custom platform descriptors come from POST /api/custom — untrusted input. The contract is
// that they stay pure data (paths and file names), so validation is the whole defence: if
// anything here regresses, a user's platforms.json becomes an execution surface.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, sep } from 'node:path';
import { expandRoot, validateCustom } from '../lib/custom.mjs';
import { HOME } from '../lib/paths.mjs';
import { setLocale } from '../lib/i18n.mjs';

// Assertions read the English messages on purpose: the active locale otherwise depends on
// the machine, so these would pass locally and fail on CI.
setLocale('en');

test('expandRoot handles ~ and passes other paths through untouched', () => {
  assert.equal(expandRoot('~'), HOME);
  assert.equal(expandRoot('~' + sep + 'x'), join(HOME, 'x'));
  const abs = join(HOME, 'abs');
  assert.equal(expandRoot(abs), abs);
  assert.equal(expandRoot('relative/path'), 'relative/path');
});

test('accepts a minimal descriptor and slugs the id', () => {
  const [e] = validateCustom([{ label: 'My Tool', roots: [join(HOME, 'tool')] }]);
  assert.equal(e.id, 'custom-my-tool');
  assert.equal(e.label, 'My Tool');
  assert.deepEqual(e.roots, [join(HOME, 'tool')]);
  assert.equal(e.memoryDir, '');
  assert.equal(e.index, '');
});

test('duplicate labels get a numeric suffix', () => {
  const out = validateCustom([
    { label: 'Same', roots: [join(HOME, 'a')] },
    { label: 'Same', roots: [join(HOME, 'b')] },
  ]);
  assert.deepEqual(out.map((e) => e.id), ['custom-same', 'custom-same-2']);
});

test('roots accept a comma-separated string', () => {
  const [e] = validateCustom([{ label: 'x', roots: join(HOME, 'a') + ',' + join(HOME, 'b') }]);
  assert.equal(e.roots.length, 2);
});

test('rejects malformed input', () => {
  assert.throws(() => validateCustom({}), /array/);
  assert.throws(() => validateCustom([{ label: '', roots: [join(HOME, 'a')] }]), /1-60/);
  assert.throws(() => validateCustom([{ label: 'x', roots: ['relative/path'] }]), /absolute/);
  assert.throws(() => validateCustom([{ label: 'x', roots: [HOME + sep + '..' + sep + 'etc'] }]), /\.\./);
  assert.throws(() => validateCustom([{ label: 'x', roots: [join(HOME, 'a')], memoryDir: '..' }]), /\.\./);
  assert.throws(() => validateCustom([{ label: 'x', roots: [join(HOME, 'a')], index: 'sub/MEMORY.md' }]), /index/);
});

test('rejects more roots than the cap', () => {
  const roots = Array.from({ length: 9 }, (_, i) => join(HOME, 'r' + i));
  assert.throws(() => validateCustom([{ label: 'x', roots }]), /1-8/);
});
