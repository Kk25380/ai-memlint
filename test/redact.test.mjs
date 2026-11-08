// Regression suite for the credential classifier. Both directions matter: shapes that must
// be caught, and shapes that must not be. A noisy rule trains people to ignore the report —
// which is exactly what happened when `key-path` matched JS property access and flagged
// every .mjs file in this repo as sensitive.
//
// Fixtures are assembled from parts on purpose: a literal key path or AppID in this file
// would make the classifier flag the tool's own source. Every value here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, mask, report } from '../lib/redact.mjs';

const HEX32 = '0123456789abcdef'.repeat(2);
const APPID = 'wx' + '0123456789abcdef';
const KEY_PATH = ['keys', 'server.pem'].join('/');
const PRIVATE_KEY = 'private.' + 'example' + '.key';

const rulesOf = (text) => [...new Set(classify(text).hits.map((h) => h.rule))];

test('bare hex is not a secret', () => {
  assert.equal(classify('commit ' + HEX32 + ' landed').level, 'clean');
});

test('32 hex behind a keyword is secret-value, and the hit carries the group', () => {
  const { level, hits } = classify('小程序 AppSecret：' + HEX32);
  assert.equal(level, 'secret-value');
  assert.deepEqual(hits.map((h) => h.rule), ['hex32-secret']);
  assert.equal(hits[0].value, HEX32);
});

test('level is the maximum over all hits', () => {
  assert.equal(classify('AppID ' + APPID + ' / AppSecret ' + HEX32).level, 'secret-value');
  assert.equal(classify('AppID ' + APPID).level, 'sensitive');
});

test('property access is not a key path', () => {
  // Regression: this shape flagged every .mjs file in the repo as sensitive.
  assert.equal(classify('const k = state.key; if (bindings.key) {}').level, 'clean');
});

test('a key file path is sensitive', () => {
  assert.deepEqual(rulesOf('key at ' + KEY_PATH), ['key-path']);
});

test('a bare private.<x>.key is still covered by private-key-file', () => {
  assert.deepEqual(rulesOf('upload key: ' + PRIVATE_KEY), ['private-key-file']);
});

test('hits carry 1-based line numbers', () => {
  const text = ['first', 'AppSecret ' + HEX32, 'AppSecret ' + HEX32].join('\n');
  assert.deepEqual(classify(text).hits.map((h) => h.line), [2, 3]);
});

test('mask preserves line structure and the keyword', () => {
  const text = ['head', 'AppSecret ' + HEX32, 'tail'].join('\n');
  const out = mask(text);
  assert.equal(out.split('\n').length, 3);
  assert.equal(out.includes(HEX32), false);
  assert.ok(out.includes('AppSecret'));
  assert.ok(out.includes('[redacted:hex32-secret]'));
});

test('report aggregates by level and by rule', () => {
  const r = report([
    { level: 'clean', hits: [] },
    { level: 'sensitive', hits: [{ rule: 'key-path' }] },
  ]);
  assert.deepEqual(r.byLevel, { clean: 1, sensitive: 1, 'secret-value': 0 });
  assert.equal(r.byRule['key-path'], 1);
  assert.equal(r.exposed.length, 1);
});
