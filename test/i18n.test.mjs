// The dictionary is where a mistake is invisible at runtime: a missing key silently falls
// back to English, so only a parity check catches it. This file is also the contract a new
// translation has to satisfy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, detectLocale, localeNames, setLocale, t } from '../lib/i18n.mjs';

const baseKeys = Object.keys(LOCALES.en).sort();
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('every locale defines exactly the base key set', () => {
  for (const name of localeNames) {
    assert.deepEqual(Object.keys(LOCALES[name]).sort(), baseKeys, `${name} keys differ from en`);
  }
});

test('no locale ships an empty message', () => {
  for (const name of localeNames) {
    for (const k of baseKeys) {
      assert.ok(String(LOCALES[name][k]).trim().length > 0, `${name} has an empty value for ${k}`);
    }
  }
});

test('placeholder names match across locales', () => {
  for (const k of baseKeys) {
    assert.deepEqual(holes(LOCALES.zh[k]), holes(LOCALES.en[k]), `placeholders differ for ${k}`);
  }
});

test('detectLocale maps a tag onto a supported locale', () => {
  assert.equal(detectLocale('zh'), 'zh');
  assert.equal(detectLocale('zh-CN'), 'zh');
  assert.equal(detectLocale('en-US'), 'en');
  // An unsupported tag falls through to env/OS, which must still land on a real locale.
  assert.ok(localeNames.includes(detectLocale('fr-FR')));
});

test('setLocale switches messages and interpolation', () => {
  setLocale('en');
  assert.equal(t('verify.pass'), 'PASS');
  assert.equal(t('skills.copies', { n: 3 }), ' ×3 copies');
  setLocale('zh');
  assert.equal(t('verify.pass'), '通过');
  assert.equal(t('skills.copies', { n: 3 }), ' ×3 份副本');
});

test('an unknown key degrades to the key, and an unknown placeholder stays visible', () => {
  setLocale('en');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(t('doctor.scan', {}), LOCALES.en['doctor.scan']);
  assert.ok(t('doctor.scan', { roots: 1 }).includes('{shapes}'));
});
