// User-defined platform descriptors for platforms the built-in registry does not know.
// Lives in the data root, not the source tree: a user's additions must never dirty the
// audited code, and cloning the repo never carries someone's private paths.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, sep } from 'node:path';
import { DATA_ROOT, HOME } from './paths.mjs';
import { PLATFORMS } from './registry.mjs';
import { t } from './i18n.mjs';

export const CUSTOM_PATH = join(DATA_ROOT, 'platforms.json');
const MAX_ENTRIES = 32;
const MAX_ROOTS = 8;

export function expandRoot(p) {
  const s = String(p).trim();
  if (s === '~') return HOME;
  if (s.startsWith('~' + sep) || s.startsWith('~/')) return join(HOME, s.slice(2));
  return s;
}

const hasDotDot = (s) => String(s).split(/[\\/]/).includes('..');

function slugId(label, taken) {
  const base = 'custom-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'platform';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = base + '-' + i;
  taken.add(id);
  return id;
}

// Descriptors are pure data: paths and file names only, no regex or code, so a custom
// entry can never turn into an execution surface.
export function validateCustom(list) {
  if (!Array.isArray(list)) throw new Error(t('custom.errArray'));
  if (list.length > MAX_ENTRIES) throw new Error(t('custom.errMax', { n: MAX_ENTRIES }));
  const taken = new Set(PLATFORMS.map((p) => p.id));
  const out = [];
  for (const raw of list) {
    const label = String(raw?.label ?? '').trim();
    if (!label || label.length > 60) throw new Error(t('custom.errLabel'));
    const roots = (Array.isArray(raw?.roots) ? raw.roots : String(raw?.roots ?? '').split(/[,;\n]/))
      .map((r) => String(r).trim()).filter(Boolean);
    if (!roots.length || roots.length > MAX_ROOTS) throw new Error(t('custom.errRoots', { label, max: MAX_ROOTS }));
    for (const r of roots) {
      const e = expandRoot(r);
      if (!isAbsolute(e)) throw new Error(t('custom.errAbsolute', { label, root: r }));
      if (hasDotDot(e)) throw new Error(t('custom.errDotDotRoot', { label }));
    }
    const memoryDir = String(raw?.memoryDir ?? '').trim();
    if (hasDotDot(memoryDir)) throw new Error(t('custom.errDotDotMemory', { label }));
    const index = String(raw?.index ?? '').trim();
    if (index && /[\\/]/.test(index)) throw new Error(t('custom.errIndex', { label }));
    out.push({ id: slugId(label, taken), label, roots, memoryDir, index });
  }
  return out;
}

export function loadCustom() {
  if (!existsSync(CUSTOM_PATH)) return { platforms: [], error: null };
  try {
    const j = JSON.parse(readFileSync(CUSTOM_PATH, 'utf8'));
    return { platforms: validateCustom(j?.platforms ?? []), error: null };
  } catch (e) {
    return { platforms: [], error: '自定义平台配置无法解析，已忽略: ' + (e?.message || e) };
  }
}

export function saveCustom(list) {
  const clean = validateCustom(list);
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(CUSTOM_PATH, JSON.stringify({ schema: 1, platforms: clean }, null, 2));
  return clean;
}

export function customToEntry(c) {
  return {
    id: c.id, label: c.label, family: 'custom', custom: true,
    roots: c.roots.map(expandRoot),
    memory: { custom: { dir: c.memoryDir || '', notes: '*.md', index: c.index || undefined } },
    parse: {},
  };
}
