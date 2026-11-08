// Migration report: turns the skill inventory into a copy checklist.
// It never touches a file. Moving skills would be a write into another platform's
// directory, and this tool's whole trust surface is "reads sources, writes only its own
// data root" — so the commands are printed and the user decides whether to run them.
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { HOME } from './registry.mjs';
import { t } from './i18n.mjs';

const relHome = (p) => relative(HOME, p).split(sep).join('/');
const short = (s) => (s ? { platform: s.platform, rel: s.rel, dir: s.dir, hash: s.hash, bytes: s.bytes, level: s.level, manifestName: s.manifestName } : null);

// A "container" is a directory that skill folders sit in. Where a descriptor states the
// convention (<root>/<skillsInstall>, measured per platform) that container is installable.
// Every other observed container is still listed, but only as a place to copy *from*:
// trae's builtin_skills and openclaw's workspace/skills are app-managed, not install dirs.
export function skillTargets(scan) {
  const byDir = new Map();
  const add = (t) => {
    const prev = byDir.get(t.dir);
    if (!prev || (t.installable && !prev.installable)) byDir.set(t.dir, t);
  };

  for (const p of scan.platforms) {
    if (!p.installed || !p.skillsInstall) continue;
    for (const root of p.roots) {
      const dir = join(root, p.skillsInstall);
      add({
        key: p.roots.length > 1 ? `${p.id}/${basename(root)}` : p.id,
        label: p.roots.length > 1 ? `${p.label} (${basename(root)})` : p.label,
        platform: p.id, root, dir, rel: relHome(dir), custom: p.custom,
        kind: 'declared', installable: true,
      });
    }
  }

  const byRoot = new Map();
  for (const s of scan.skills) {
    if (!byRoot.has(s.root)) byRoot.set(s.root, []);
    byRoot.get(s.root).push(s);
  }
  for (const [root, skills] of byRoot) {
    const attributed = skills.find((s) => s.platform)?.platform ?? null;
    const skillDirs = skills.map((s) => s.dir);
    const containers = new Set(skills.map((s) => dirname(s.dir)));
    for (const c of containers) {
      // A skill bundle may carry skills of its own; that inner dir is not a container.
      if (skillDirs.some((d) => c === d || c.startsWith(d + sep))) continue;
      add({
        key: relHome(c), label: relHome(c), platform: attributed, root, dir: c,
        rel: relHome(c), custom: false, kind: 'observed', installable: !attributed,
      });
    }
  }

  const targets = [...byDir.values()];
  for (const t of targets) t.skills = scan.skills.filter((s) => dirname(s.dir) === t.dir).length;
  return targets.sort((a, b) => b.installable - a.installable || b.skills - a.skills || a.key.localeCompare(b.key));
}

// A key resolves exactly, then as a home-relative path, then as a bare platform id, so
// `--to=qoder` works without knowing how many roots a platform declares.
const resolve = (targets, key, installable) => {
  const pool = installable ? targets.filter((t) => t.installable) : targets;
  return pool.find((t) => t.key === key)
    ?? pool.find((t) => t.rel === key)
    ?? pool.find((t) => t.platform && t.platform === key);
};

export function migrationReport(scan, targetKey, sourceKey) {
  const targets = skillTargets(scan);
  const target = resolve(targets, targetKey, true);
  if (!target) return { error: t('migrate.errTarget', { key: targetKey ?? '—' }), targets };
  const source = sourceKey ? resolve(targets, sourceKey, false) : null;
  if (sourceKey && !source) return { error: t('migrate.errSource', { key: sourceKey }), targets };
  if (source && source.dir === target.dir) return { error: t('migrate.errSame'), targets };

  // Without a source filter every skill anywhere else is a candidate, which on a real
  // machine is a hundred-plus lines; with one, the checklist covers a single directory.
  const inScope = (s) => (source ? dirname(s.dir) === source.dir : dirname(s.dir) !== target.dir);

  const atTarget = new Map();
  for (const s of scan.skills) if (dirname(s.dir) === target.dir) atTarget.set(s.name, s);

  const groups = new Map();
  for (const s of scan.skills) {
    if (!inScope(s)) continue;
    if (!groups.has(s.name)) groups.set(s.name, []);
    groups.get(s.name).push(s);
  }

  const items = [];
  for (const [name, sources] of groups) {
    // Several copies of one skill can disagree. Suggest the version most roots agree on,
    // and break ties by path so the same scan always yields the same checklist.
    const tally = new Map();
    for (const s of sources) tally.set(s.hash, (tally.get(s.hash) ?? 0) + 1);
    const top = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const chosen = sources.filter((s) => s.hash === top[0]).sort((a, b) => a.rel.localeCompare(b.rel))[0];
    const current = atTarget.get(name) ?? null;
    const state = !current ? 'missing' : current.hash === chosen.hash ? 'same' : 'conflict';

    const warnings = [];
    if (chosen.level !== 'clean') {
      warnings.push(t('migrate.sensitive', {
        level: chosen.level,
        rules: chosen.rules.length ? t('migrate.sensitiveRules', { rules: chosen.rules.join(', ') }) : '',
      }));
    }
    if (!chosen.manifestName) warnings.push(t('migrate.noManifestName'));
    else if (chosen.manifestName !== chosen.name) warnings.push(t('migrate.nameMismatch', { name: chosen.name, manifestName: chosen.manifestName }));
    const nested = scan.skills.filter((s) => s.dir !== chosen.dir && s.dir.startsWith(chosen.dir + sep));
    if (nested.length) warnings.push(t('migrate.nested', { n: nested.length }));
    if (top[1] < sources.length) warnings.push(t('migrate.majority', { copies: sources.length, diff: sources.length - top[1] }));
    if (state === 'conflict') warnings.push(t('migrate.conflict', { current: current.hash.slice(0, 8), chosen: chosen.hash.slice(0, 8) }));

    items.push({
      name, state, copies: sources.length,
      chosen: short(chosen), current: short(current), sources: sources.map(short),
      warnings,
      command: state === 'missing' ? `cp -r "${chosen.dir}" "${target.dir}"` : null,
    });
  }

  const order = { missing: 0, conflict: 1, same: 2 };
  items.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));

  const counts = { total: items.length, missing: 0, same: 0, conflict: 0 };
  for (const i of items) counts[i.state]++;

  return {
    target: { key: target.key, label: target.label, platform: target.platform, dir: target.dir, rel: target.rel, kind: target.kind, skills: target.skills },
    source: source ? { key: source.key, label: source.label, rel: source.rel, dir: source.dir, kind: source.kind } : null,
    targets,
    generatedAt: new Date().toISOString(),
    // Stated in the payload so every renderer repeats it: this is a plan, not an action.
    executed: false,
    counts,
    prepare: existsSync(target.dir) ? [] : [`mkdir -p "${target.dir}"`],
    items,
    note: t('migrate.note'),
  };
}
