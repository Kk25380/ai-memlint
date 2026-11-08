// Frontmatter parsing is fed untrusted manifests from arbitrary platforms. The cases below
// are the ones that actually broke on real data: a BOM hiding the fence, and block scalars
// (`|`, `>`) arriving as a literal pipe or chevron.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../lib/skills.mjs';

test('parses name, description and field order', () => {
  const m = parseManifest('---\nname: demo\ndescription: does a thing\ntools: bash\n---\nbody');
  assert.equal(m.name, 'demo');
  assert.equal(m.description, 'does a thing');
  assert.deepEqual(m.fields, ['name', 'description', 'tools']);
});

test('a BOM does not hide the fence', () => {
  // Regression: two Windows-authored manifests were silently unparsed this way.
  assert.equal(parseManifest('\ufeff---\nname: demo\n---\n').name, 'demo');
});

test('CRLF line endings parse', () => {
  assert.equal(parseManifest('---\r\nname: demo\r\n---\r\n').name, 'demo');
});

test('block scalars join their indented body', () => {
  const literal = '---\nname: demo\ndescription: |\n  first line\n  second line\n---\n';
  assert.equal(parseManifest(literal).description, 'first line second line');
  const folded = '---\ndescription: >-\n  folded\n  text\n---\n';
  assert.equal(parseManifest(folded).description, 'folded text');
});

test('surrounding quotes are stripped', () => {
  const m = parseManifest('---\nname: "quoted"\ndescription: \'single\'\n---\n');
  assert.equal(m.name, 'quoted');
  assert.equal(m.description, 'single');
});

test('no frontmatter yields nulls, not a partial parse', () => {
  assert.deepEqual(parseManifest('# heading\nname: not frontmatter\n'), { name: null, description: null, fields: [] });
});

test('keys with - and _ are captured', () => {
  assert.deepEqual(parseManifest('---\nallowed-tools: x\nsome_key: y\n---\n').fields, ['allowed-tools', 'some_key']);
});
