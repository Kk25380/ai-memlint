// Locale resolution and message lookup.
//
// One process, one locale: setLocale() swaps the active dictionary, so no module has to
// thread a translator through its signatures. That is a deliberate trade — a global — for a
// CLI that runs once with one language.
//
// English is the base. A key missing from the active locale falls back to English, then to
// the key itself, so a gap degrades into readable text instead of a raw identifier.
import en from './locales/en.mjs';
import zh from './locales/zh.mjs';

export const LOCALES = { en, zh };
export const localeNames = Object.keys(LOCALES);

function pick(tag) {
  const s = String(tag ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('en')) return 'en';
  return null;
}

function osLocale() {
  try { return pick(Intl.DateTimeFormat().resolvedOptions().locale); } catch { return null; }
}

// Explicit argument wins over the environment, which wins over the OS locale.
export function detectLocale(explicit) {
  return pick(explicit) ?? pick(process.env.AI_MEMLINT_LANG) ?? osLocale() ?? 'en';
}

let active = detectLocale();
let dict = LOCALES[active] ?? LOCALES.en;

export function setLocale(locale) {
  active = pick(locale) ?? detectLocale(locale);
  dict = LOCALES[active] ?? LOCALES.en;
  return active;
}

export const locale = () => active;

export function t(key, vars) {
  const s = dict[key] ?? LOCALES.en[key] ?? key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}
