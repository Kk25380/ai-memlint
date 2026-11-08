// Three-stage probe: enumerate install roots -> shape-match -> attribute to registry.
// Produces facts only. lib/findings.mjs turns them into actionable findings.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { PLATFORMS, HOME, anyMarker } from './registry.mjs';
import { classify } from './redact.mjs';
import { customToEntry, loadCustom } from './custom.mjs';
import { parseManifest } from './skills.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const MAX_DEPTH = 4;
const EXCLUDE_SEGMENTS = new Set([
  'node_modules', 'skills', 'plugins', 'extensions', 'workspace', 'temp', 'tmp',
  'cache', 'Cache', 'agents', 'binaries', 'logs', 'diagnostics', 'builtin',
  '.git', 'dist', 'build', '.Trash', 'backup', 'backups',
]);
const EXCLUDE_PATTERNS = [/^web-template/, /\.replacing-\d+/, /^compression-v2$/];
const MEMORY_DIR_SHAPES = [/^memor/i, /^memery$/i, /^memories$/i, /^记忆$/];
const MEMORY_FILE_SHAPES = [/^(AGENTS|CLAUDE|GEMINI|MEMORY)\.md$/i, /\.mdc$/i, /^\.(cursor|cline|continue)rules$/i];

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const safeReaddir = (p) => { try { return readdirSync(p); } catch { return []; } };

// Several hits of one rule can land on one line; the reader highlights lines, not hits.
function dedupeMarks(marks) {
  const seen = new Set();
  return marks
    .filter((m) => (seen.has(m.rule + '\u0000' + m.line) ? false : (seen.add(m.rule + '\u0000' + m.line), true)))
    .sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

function excluded(path) {
  const parts = path.split(sep);
  return parts.some((s) => EXCLUDE_SEGMENTS.has(s) || EXCLUDE_PATTERNS.some((r) => r.test(s)));
}

// ---- Stage 1: mechanical root enumeration, no name list ----
export function enumerateRoots() {
  const roots = [];
  for (const e of safeReaddir(HOME)) {
    if (!e.startsWith('.')) continue;
    const p = join(HOME, e);
    if (isDir(p) && !excluded(p)) roots.push(p);
  }
  const appBase =
    process.platform === 'win32' ? join(HOME, 'AppData', 'Roaming')
    : process.platform === 'darwin' ? join(HOME, 'Library', 'Application Support')
    : join(HOME, '.config');
  for (const e of safeReaddir(appBase)) {
    const p = join(appBase, e);
    if (isDir(p) && !excluded(p)) roots.push(p);
  }
  return roots;
}

// ---- Stage 2: shape match ----
function walk(dir, depth, hits) {
  if (depth > MAX_DEPTH || excluded(dir)) return;
  for (const e of safeReaddir(dir)) {
    const p = join(dir, e);
    if (isDir(p)) {
      if (MEMORY_DIR_SHAPES.some((r) => r.test(e))) hits.push({ path: p, kind: 'dir', shape: e });
      walk(p, depth + 1, hits);
    } else if (isFile(p) && MEMORY_FILE_SHAPES.some((r) => r.test(e))) {
      hits.push({ path: p, kind: 'file', shape: e });
    }
  }
}

export function shapeScan(roots) {
  const hits = [];
  for (const r of roots) walk(r, 1, hits);
  return hits;
}

// ---- Skill inventory: mechanical walk, own exclusion policy ----
// `skills`, `agents`, `cache`, `plugins` are exactly where skills live, so the memory-scan
// exclusions cannot be reused. What is dropped here is catalogs and copies that are not
// installed skills: marketplace clones, install caches, snapshots, staging/trash dirs.
// Measured on this host: those account for ~4700 of ~4850 SKILL.md files below depth 4.
const SKILL_MAX_DEPTH = 4;
const SKILL_EXCLUDE_SEGMENTS = new Set(['node_modules', '.git', 'tmp', 'temp']);
const SKILL_EXCLUDE_PATTERNS = [
  /^web-template/, /marketplaces?$/i, /^caches?$/i, /snapshots?$/i,
  /\.(staging|replacing|tmp)-/, /(^|[._-])(backup|backups|bak|trash)([._-]|$)/i,
];

function skillExcluded(path) {
  const parts = path.split(sep);
  return parts.some((s) => SKILL_EXCLUDE_SEGMENTS.has(s) || SKILL_EXCLUDE_PATTERNS.some((r) => r.test(s)));
}

function walkSkills(dir, depth, hits, root) {
  if (depth > SKILL_MAX_DEPTH || skillExcluded(dir)) return;
  for (const e of safeReaddir(dir)) {
    const p = join(dir, e);
    if (isDir(p)) walkSkills(p, depth + 1, hits, root);
    else if (isFile(p) && /^skill\.md$/i.test(e)) hits.push({ manifest: p, dir: dirname(p), name: basename(dirname(p)), root });
  }
}

function probeSkills(roots, entries) {
  const hits = [];
  for (const r of roots) walkSkills(r, 1, hits, r);
  // A root can be a symlink into another root (~/.marvis -> AppData/Roaming/Tencent/Marvis),
  // so the same manifest may be reached twice. Keep the shortest path: one skill, one row.
  const byReal = new Map();
  for (const h of hits) {
    let real = h.manifest;
    try { real = realpathSync(h.manifest); } catch {}
    const prev = byReal.get(real);
    if (!prev || h.manifest.length < prev.manifest.length) byReal.set(real, h);
  }
  const skills = [];
  for (const h of byReal.values()) {
    let text;
    try { text = readFileSync(h.manifest, 'utf8'); } catch { continue; }
    const man = parseManifest(text);
    const { level, hits: rh } = classify(text);
    const a = attribute({ path: h.dir }, entries);
    skills.push({
      platform: a?.platform.id ?? null,
      root: a?.root ?? h.root,
      rel: relative(HOME, h.dir),
      name: h.name, manifestName: man.name, description: man.description, fields: man.fields,
      dir: h.dir, manifest: h.manifest,
      bytes: Buffer.byteLength(text), hash: sha(text),
      level, rules: [...new Set(rh.map((x) => x.rule))],
    });
  }
  skills.sort((x, y) => (x.platform ?? '~').localeCompare(y.platform ?? '~') || x.rel.localeCompare(y.rel));
  return skills;
}

// ---- Stage 3: attribution ----
function attribute(hit, entries) {
  let best = null;
  for (const p of entries) {
    for (const root of p.roots) {
      if (hit.path === root || hit.path.startsWith(root + sep)) {
        const depth = hit.path.slice(root.length).split(sep).length;
        if (!best || depth < best.depth) best = { platform: p, root, depth };
      }
    }
  }
  return best;
}

// ---- glob + scope resolution ----
function matchGlob(name, glob) {
  if (!glob) return false;
  const rx = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  return rx.test(name);
}

function resolveScopes(root, dirTpl) {
  let cur = [{ dir: root, bindings: {} }];
  for (const part of dirTpl.split('/')) {
    const next = [];
    for (const { dir, bindings } of cur) {
      if (!isDir(dir)) continue;
      if (part.startsWith('{') && part.endsWith('}')) {
        const name = part.slice(1, -1);
        for (const e of safeReaddir(dir)) {
          const fp = join(dir, e);
          if (isDir(fp)) next.push({ dir: fp, bindings: { ...bindings, [name]: e } });
        }
      } else {
        const fp = join(dir, part);
        if (isDir(fp)) next.push({ dir: fp, bindings });
      }
    }
    cur = next;
  }
  return cur;
}

function parseIndex(indexPath, expectHeader) {
  if (!indexPath || !isFile(indexPath)) return { present: false };
  let text;
  try {
    text = readFileSync(indexPath, 'utf8');
  } catch (e) {
    return { present: false, error: e.code || e.message };
  }
  const entries = [...text.matchAll(/^\s*- \[([^\]]*)\]\(([^)]+)\)/gm)].map((m) => ({ title: m[1], file: m[2] }));
  const hasHeader = /^#\s/m.test(text);
  return {
    present: true, path: indexPath, file: basename(indexPath),
    entries: entries.length, links: entries.map((e) => e.file), hasHeader,
    expectedHeader: typeof expectHeader === 'boolean' ? expectHeader : null,
    headerDrift: typeof expectHeader === 'boolean' && hasHeader !== expectHeader,
  };
}

function probeStore(entry, scopeName, scope, resolved) {
  const dir = resolved.dir;
  const ignore = entry.quirks?.ignore ?? [];
  const files = safeReaddir(dir)
    .filter((f) => isFile(join(dir, f)) && matchGlob(f, scope.notes) && f !== scope.index && !ignore.some((g) => matchGlob(f, g)));

  const notes = [];
  const unreadable = [];
  for (const f of files) {
    const p = join(dir, f);
    let text;
    try {
      text = readFileSync(p, 'utf8');
    } catch (e) {
      // A binary blob or a locked file must skip the file, not abort the scan.
      unreadable.push({ file: f, path: p, error: e.code || e.message });
      continue;
    }
    const { level, hits } = classify(text);
    notes.push({
      file: f, slug: basename(f, '.md'), bytes: Buffer.byteLength(text), path: p,
      hasFrontmatter: /^---\r?\n/.test(text), hash: sha(text), level,
      // Rule ids and line numbers travel; hits[].value is the plaintext secret and never
      // leaves this scope.
      rules: [...new Set(hits.map((h) => h.rule))],
      marks: dedupeMarks(hits.map((h) => ({ rule: h.rule, line: h.line }))),
    });
  }

  const index = parseIndex(scope.index ? join(dir, scope.index) : null, entry.parse?.indexHeader);
  if (index.error) unreadable.push({ file: scope.index, path: join(dir, scope.index), error: index.error });

  const linked = index.present ? new Set(index.links) : null;
  for (const n of notes) n.orphaned = linked ? !linked.has(n.file) : false;
  const dangling = index.present ? [...linked].filter((l) => !notes.some((n) => n.file === l)) : [];

  return {
    scope: scopeName, dir, projectKey: resolved.bindings.key ?? null,
    notes, unreadable, index: { ...index, dangling },
    indexExpected: !! scope.index, indexName: scope.index ?? null,
    frontmatterExpected: !! entry.parse?.frontmatter,
  };
}

export function probePlatform(entry) {
  const presentRoots = entry.roots.filter((r) => existsSync(r));
  const installed = presentRoots.length > 0 || anyMarker(entry);
  const result = {
    id: entry.id, label: entry.label, family: entry.family, custom: !!entry.custom,
    declaredRoots: entry.roots, skillsInstall: entry.skillsInstall ?? null,
    installed, roots: presentRoots, installMarkersFound: (entry.installMarkers ?? []).filter((m) => existsSync(m)),
    status: 'not-installed', stores: [], rules: [], notes: 0,
    descriptorNote: entry.parse?.note ?? entry.quirks?.note ?? null,
  };
  if (!installed) return result;

  for (const root of presentRoots) {
    if (entry.rules) {
      for (const d of entry.rules.dirs ?? []) {
        const p = join(root, d);
        if (isDir(p)) result.rules.push({ path: p, files: safeReaddir(p).filter((f) => isFile(join(p, f))) });
      }
      for (const f of entry.rules.files ?? []) {
        const p = join(root, f);
        if (isFile(p)) result.rules.push({ path: p, files: [f] });
      }
      for (const g of entry.rules.globs ?? []) {
        const found = safeReaddir(root).filter((f) => isFile(join(root, f)) && matchGlob(f, g));
        if (found.length) result.rules.push({ path: root, files: found });
      }
    }
    if (!entry.memory) continue;
    for (const [scopeName, scope] of Object.entries(entry.memory)) {
      for (const resolved of resolveScopes(root, scope.dir)) {
        const store = probeStore(entry, scopeName, scope, resolved);
        result.stores.push({ ...store, root });
        result.notes += store.notes.length;
      }
    }
  }

  const hasNotes = result.notes > 0;
  result.status = hasNotes ? 'detected'
    : result.stores.length ? 'detected-empty'
    : result.rules.length ? 'rules-only'
    : 'installed-no-memory';
  return result;
}

// The skill walk is opt-in. It stats every directory under every root down to depth 4,
// which measured ~2.1s on this host against ~0.1s for the memory audit — too slow to
// impose on doctor and verify. Callers that need the inventory ask for it explicitly.
export function probeAll({ skills: wantSkills = false } = {}) {
  const roots = enumerateRoots();
  const hits = shapeScan(roots);

  const custom = loadCustom();
  const entries = [...PLATFORMS, ...custom.platforms.map(customToEntry)];
  const platforms = entries.map(probePlatform);
  const skills = wantSkills ? probeSkills(roots, entries) : [];
  const unknown = [];
  const gaps = [];
  for (const h of hits) {
    const a = attribute(h, entries);
    if (!a) {
      unknown.push({ path: h.path, kind: h.kind, shape: h.shape, rel: relative(HOME, h.path) });
      continue;
    }
    // A shape hit inside a known root that the descriptor does not cover => descriptor gap.
    const covered = platforms.find((x) => x.id === a.platform.id)
      ?.stores.some((s) => h.path === s.dir || h.path.startsWith(s.dir + sep));
    if (!covered && h.kind === 'dir') gaps.push({ platform: a.platform.id, path: h.path, rel: relative(HOME, h.path) });
  }

  // Same key claimed by several platforms with differing content. Computed in one pass
  // over the scan instead of incrementally against a store, so it needs no prior run.
  const byKey = new Map();
  const seenKeys = [];
  for (const p of platforms) {
    if (!p.installed) continue;
    for (const s of p.stores) {
      for (const n of s.notes) {
        const k = [s.scope, s.projectKey ?? '', n.slug].join('\u0000');
        seenKeys.push(k);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push({ platform: p.id, hash: n.hash, path: n.path });
      }
    }
  }
  const conflicts = [];
  for (const [k, owners] of byKey) {
    if (owners.length < 2 || new Set(owners.map((o) => o.hash)).size < 2) continue;
    const [scope, projectKey, slug] = k.split('\u0000');
    conflicts.push({
      scope, projectKey: projectKey || null, slug,
      owners: owners.map((o) => o.platform),
      hashes: Object.fromEntries(owners.map((o) => [o.platform, o.hash])),
      paths: owners.map((o) => o.path),
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    host: { platform: process.platform },
    rootsScanned: roots.length,
    shapeHits: hits.length,
    platforms,
    skills,
    unknown,
    descriptorGaps: gaps,
    conflicts,
    seenKeys,
    customError: custom.error,
  };
}
