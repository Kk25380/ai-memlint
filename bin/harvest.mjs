#!/usr/bin/env node
// Opt-in store materialization. The audit path (cli.mjs doctor) needs none of this — run it
// only when you want to read note bodies in the viewer.
//
// Never writes to any source platform directory, and contains no deletion calls: a note that
// disappears from its source stays in the store, and a note classified 'secret-value' is
// never copied anywhere at all.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { probeAll } from '../lib/probe.mjs';
import { mask } from '../lib/redact.mjs';
import { DATA_ROOT, LEGACY_ROOT, STATE_PATH, STORE, displayPath } from '../lib/paths.mjs';

const DRY = process.argv.includes('--dry-run');
const safeJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const data = {};
  let section = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const nested = /^\s+([\w-]+):\s*(.*)$/.exec(line);
    if (nested && section) { data[section][nested[1]] = nested[2].trim(); continue; }
    const top = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!top) continue;
    if (top[2] === '') { section = top[1]; data[top[1]] = {}; }
    else { section = null; data[top[1]] = top[2].trim(); }
  }
  return data;
}

const destFor = (scope, projectKey, slug) =>
  scope === 'user' ? join(STORE, 'user', `${slug}.md`) : join(STORE, 'project', projectKey, `${slug}.md`);

// Run history is the only non-re-derivable artifact, so it is carried across the move away
// from the legacy layout where the code root doubled as the data root.
const legacyPath = join(LEGACY_ROOT, 'state.json');
const migrating = !existsSync(STATE_PATH) && existsSync(legacyPath) ? safeJson(legacyPath) : null;
const prev = existsSync(STATE_PATH)
  ? (safeJson(STATE_PATH) ?? { version: 3, notes: {}, runs: [] })
  : (migrating ?? { version: 3, notes: {}, runs: [] });

const state = { version: 3, notes: {}, runs: prev.runs ?? [] };
const scan = probeAll();

// Group every note by its scoped key. The findings layer reports disagreements; here a
// deterministic winner (lowest platform id) takes the store slot and all sources are recorded.
const groups = new Map();
for (const platform of scan.platforms) {
  if (!platform.installed) continue;
  for (const store of platform.stores) {
    for (const note of store.notes) {
      const key = [store.scope, store.projectKey ?? '', note.slug].join('\u0000');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ platform: platform.id, scope: store.scope, projectKey: store.projectKey ?? null, note });
    }
  }
}

const out = { created: [], updated: [], unchanged: [], suppressed: [], contested: [] };
const write = (p, text) => { if (DRY) return; mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text); };

for (const key of [...groups.keys()].sort()) {
  const members = groups.get(key).sort((a, b) => a.platform.localeCompare(b.platform));
  const winner = members[0];
  const { note, scope, projectKey } = winner;
  if (members.length > 1) {
    out.contested.push({
      slug: note.slug, scope, projectKey,
      owners: members.map((m) => m.platform),
      identical: new Set(members.map((m) => m.note.hash)).size === 1,
    });
  }

  const dest = destFor(scope, projectKey, note.slug);
  const previous = prev.notes?.[key];
  const suppressed = note.level === 'secret-value';

  // The viewer masks 'sensitive' notes on render regardless, so storing the masked text
  // removes the plaintext duplicate at no cost to anything the user could actually see.
  // note.hash stays the *source* hash; the stored body is deliberately not a byte copy.
  let text = null;
  if (!suppressed) {
    const raw = readFileSync(note.path, 'utf8');
    text = note.level === 'clean' ? raw : mask(raw);
  }

  if (suppressed) {
    out.suppressed.push({ slug: note.slug, scope, projectKey, platform: winner.platform, rules: note.rules, srcPath: note.path });
  } else if (previous?.hash === note.hash && previous?.storePath === dest && existsSync(dest)) {
    out.unchanged.push({ slug: note.slug, scope, projectKey });
  } else if (existsSync(dest)) {
    out.updated.push({ slug: note.slug, scope, projectKey, previousHash: previous?.hash ?? null });
    write(dest, text);
  } else {
    out.created.push({ slug: note.slug, scope, projectKey });
    write(dest, text);
  }

  state.notes[key] = {
    slug: note.slug, scope, projectKey, platform: winner.platform,
    storePath: suppressed ? null : dest,
    suppressed,
    hash: note.hash, bytes: note.bytes, level: note.level, rules: note.rules,
    marks: note.marks ?? [],
    orphaned: note.orphaned,
    frontmatter: suppressed ? {} : parseFrontmatter(text),
    sources: members.map((m) => ({ platform: m.platform, srcPath: m.note.path, hash: m.note.hash })),
    firstSeen: previous?.firstSeen ?? new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
}

const vanished = Object.entries(prev.notes ?? {}).filter(([k]) => !groups.has(k)).map(([, v]) => v);

state.runs = [...(prev.runs ?? []), {
  at: new Date().toISOString(), dryRun: DRY,
  detected: scan.platforms.filter((p) => p.status.startsWith('detected')).length,
  notes: Object.keys(state.notes).length,
  created: out.created.length, updated: out.updated.length, unchanged: out.unchanged.length,
  suppressed: out.suppressed.length,
  contested: out.contested.filter((x) => !x.identical).length,
}].slice(-50);

if (!DRY) {
  mkdirSync(DATA_ROOT, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ---------- console ----------
const useColor = process.stdout.isTTY && !process.argv.includes('--no-color');
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const where = (n) => `${n.scope === 'user' ? 'user' : n.projectKey}/${n.slug}.md`;

console.log(`\nai-memlint harvest${DRY ? c('33', '  [DRY RUN — 未写入]') : ''}`);
console.log('='.repeat(64));
console.log(c('90', `数据根 ${displayPath(DATA_ROOT)}`));
if (migrating) console.log(c('33', `从旧数据根迁移 run 历史 ${migrating.runs?.length ?? 0} 条 <- ${displayPath(legacyPath)}`));
console.log(c('90', `源通道 ${scan.platforms.filter((p) => p.installed).length} · 笔记 ${scan.platforms.reduce((a, p) => a + p.notes, 0)} · 唯一键 ${groups.size}`));
console.log('-'.repeat(64));
console.log(`新增 ${out.created.length}  更新 ${out.updated.length}  未变 ${out.unchanged.length}  ` +
  `抑制(明文凭据,不复制) ${c(out.suppressed.length ? '31' : '90', String(out.suppressed.length))}  ` +
  `多源键 ${out.contested.length}`);

const sections = [
  ['新增', out.created, where],
  ['更新', out.updated, where],
  ['抑制 — 含明文凭据，正文不写入任何位置', out.suppressed, (n) => `${n.platform}: ${where(n)}  规则=${n.rules.join(',')}`],
  ['多源同键 — 内容不一致，未自动合并', out.contested.filter((x) => !x.identical), (n) => `${where(n)}  <- ${n.owners.join(' + ')}`],
  ['多源同键 — 内容一致，已合并', out.contested.filter((x) => x.identical), (n) => `${where(n)}  <- ${n.owners.join(' + ')}`],
  ['源已消失 — 保留不删', vanished, (n) => `${n.platform}: ${where(n)}`],
];
for (const [label, items, fmt] of sections) {
  if (!items.length) continue;
  console.log(`\n[${label}] ${items.length}`);
  items.slice(0, 60).forEach((n) => console.log(`  ${fmt(n)}`));
  if (items.length > 60) console.log(c('90', `  … 其余 ${items.length - 60} 条省略`));
}

console.log(c('90', `\nstore -> ${displayPath(STORE)}   state -> ${displayPath(STATE_PATH)}`));
console.log(c('90', 'findings 请运行: ai-memlint doctor\n'));
