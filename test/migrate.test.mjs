// Migration report is pure: it takes a scan object and returns a checklist. Every fixture
// here is synthetic and never touches the filesystem, which also keeps `verify`'s
// zero-delete / write-call inventory honest.
//
// The invariants worth guarding: an app-managed directory must never become an installable
// target, a conflicting skill must never produce a copy command, and the same scan must
// always yield the same checklist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, relative, sep } from 'node:path';
import { HOME } from '../lib/registry.mjs';
import { skillTargets, migrationReport } from '../lib/migrate.mjs';
import { setLocale } from '../lib/i18n.mjs';

// Pin the locale: these assertions read warning text, which would otherwise depend on the
// machine's locale and fail only on CI.
setLocale('en');

const rel = (p) => relative(HOME, p).split(sep).join('/');

function skill(dir, { name, hash = 'h-' + name, platform = null, root, level = 'clean', rules = [], manifestName = name } = {}) {
  return {
    platform, root, dir, rel: rel(dir), name, manifestName, description: '',
    fields: [], bytes: 100, hash, level, rules, manifest: join(dir, 'SKILL.md'),
  };
}

const qoderRoot = join(HOME, '.qoder');
const hubRoot = join(HOME, '.hub');
const ghostRoot = join(HOME, '.ai-memlint-test-nonexistent');

const qoder = { id: 'qoder', label: 'Qoder', installed: true, skillsInstall: 'skills', roots: [qoderRoot], custom: false };
const appManaged = { id: 'app', label: 'App', installed: true, skillsInstall: null, roots: [join(HOME, '.app')], custom: false };
const scanOf = (platforms, skills) => ({ platforms, skills });

test('a declared skillsInstall becomes an installable target', () => {
  const [t] = skillTargets(scanOf([qoder], []));
  assert.equal(t.key, 'qoder');
  assert.equal(t.kind, 'declared');
  assert.equal(t.installable, true);
  assert.equal(t.rel, '.qoder/skills');
});

test('a platform with several roots keys its targets by root basename', () => {
  const multi = {
    id: 'multi', label: 'Multi', installed: true, skillsInstall: 'skills',
    roots: [join(HOME, '.m1'), join(HOME, '.m2')], custom: false,
  };
  assert.deepEqual(skillTargets(scanOf([multi], [])).map((t) => t.key).sort(), ['multi/.m1', 'multi/.m2']);
});

test('an unattributed container is installable; one under a known platform is source-only', () => {
  const skills = [
    skill(join(hubRoot, 'skills', 'a'), { name: 'a', root: hubRoot }),
    skill(join(qoderRoot, 'workspace', 'skills', 'b'), { name: 'b', root: qoderRoot, platform: 'qoder' }),
  ];
  const targets = skillTargets(scanOf([qoder], skills));
  const hub = targets.find((t) => t.rel === '.hub/skills');
  const workspace = targets.find((t) => t.rel === '.qoder/workspace/skills');
  assert.equal(hub.installable, true);
  assert.equal(workspace.installable, false);
  assert.equal(workspace.platform, 'qoder');
});

test('a skill bundle nested inside a skill is not a container', () => {
  const outer = join(hubRoot, 'skills', 'a');
  const skills = [
    skill(outer, { name: 'a', root: hubRoot }),
    skill(join(outer, 'nested', 'b'), { name: 'b', root: hubRoot }),
  ];
  const rels = skillTargets(scanOf([], skills)).map((t) => t.rel);
  assert.ok(rels.includes('.hub/skills'));
  assert.equal(rels.includes('.hub/skills/a/nested'), false);
});

test('report states: missing / same / conflict, and only missing carries a command', () => {
  const targetDir = join(qoderRoot, 'skills');
  const skills = [
    skill(join(targetDir, 'same'), { name: 'same', hash: 'H', root: qoderRoot, platform: 'qoder' }),
    skill(join(hubRoot, 'skills', 'same'), { name: 'same', hash: 'H', root: hubRoot }),
    skill(join(targetDir, 'conf'), { name: 'conf', hash: 'A', root: qoderRoot, platform: 'qoder' }),
    skill(join(hubRoot, 'skills', 'conf'), { name: 'conf', hash: 'B', root: hubRoot }),
    skill(join(hubRoot, 'skills', 'fresh'), { name: 'fresh', hash: 'N', root: hubRoot }),
  ];
  const r = migrationReport(scanOf([qoder], skills), 'qoder', '.hub/skills');
  const by = Object.fromEntries(r.items.map((i) => [i.name, i]));

  assert.equal(by.same.state, 'same');
  assert.equal(by.same.command, null);

  assert.equal(by.conf.state, 'conflict');
  assert.equal(by.conf.command, null);
  assert.ok(by.conf.warnings.some((w) => w.includes('do not overwrite')));

  assert.equal(by.fresh.state, 'missing');
  assert.match(by.fresh.command, /^cp -r /);

  assert.equal(r.executed, false);
  assert.deepEqual(r.counts, { total: 3, missing: 1, same: 1, conflict: 1 });
});

test('the majority hash wins when copies disagree', () => {
  const skills = [
    skill(join(hubRoot, 'skills', 'x'), { name: 'x', hash: 'MAJOR', root: hubRoot }),
    skill(join(hubRoot, 'other', 'x'), { name: 'x', hash: 'MAJOR', root: hubRoot }),
    skill(join(hubRoot, 'third', 'x'), { name: 'x', hash: 'MINOR', root: hubRoot }),
  ];
  const item = migrationReport(scanOf([qoder], skills), 'qoder').items.find((i) => i.name === 'x');
  assert.equal(item.copies, 3);
  assert.equal(item.chosen.hash, 'MAJOR');
  assert.ok(item.warnings.some((w) => w.includes('majority version')));
});

test('unknown target, same source and target, and app-managed target are all refused', () => {
  const scan = scanOf([qoder], [skill(join(hubRoot, 'skills', 'a'), { name: 'a', root: hubRoot })]);
  assert.match(migrationReport(scan, 'nope').error, /Unknown migration target/);
  assert.match(migrationReport(scan, 'qoder', 'qoder').error, /same directory/);
  // No skillsInstall means only app-managed dirs: nothing may be installed into them.
  assert.match(migrationReport(scanOf([appManaged], []), 'app').error, /Unknown migration target/);
});

test('mkdir is only suggested when the target dir is absent', () => {
  const ghost = {
    id: 'ghost', label: 'Ghost', installed: true, skillsInstall: 'skills',
    roots: [ghostRoot], custom: false,
  };
  const r = migrationReport(scanOf([ghost], []), 'ghost');
  assert.equal(r.prepare.length, 1);
  assert.match(r.prepare[0], /^mkdir -p /);
});
