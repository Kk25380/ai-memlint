#!/usr/bin/env node
// ai-memlint CLI. Audit-first: the default path (doctor) writes nothing at all.
//
//   doctor     scan + report findings            (default; zero writes)
//   platforms  what the registry looks for, and what matched here
//   skills     skill inventory + migration checklist (prints commands, never runs them)
//   verify     trust assertions + source-file integrity
//   harvest    opt-in: materialize a readable store under the data root
//   view       start the loopback viewer and open a browser
//
// Findings carry data only; the prose lives in this file, lib/findings.mjs, lib/migrate.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { PLATFORMS } from '../lib/registry.mjs';
import { probeAll } from '../lib/probe.mjs';
import { migrationReport, skillTargets } from '../lib/migrate.mjs';
import { BLAMES, CATALOG, SEVERITIES, SEVERITY_ORDER, collect, partitionByBlame, renderFix, summarize } from '../lib/findings.mjs';
import { runAssertions, sameSnapshot, snapshotDir } from '../lib/verify.mjs';
import { BIN, DATA_ROOT, HOME, LEGACY_ROOT, REPORT_PATH, SKILLS_REPORT_PATH, STATE_PATH, displayPath, resolve as resolveRoots } from '../lib/paths.mjs';
import { localeNames, setLocale, t } from '../lib/i18n.mjs';

// Resolved lazily: the locale comes from argv, which is parsed after this module loads.
const usage = () => t('cli.usage');

// ---------- argv ----------
function parseArgs(argv) {
  const args = argv.slice(2);
  const commands = new Set(['doctor', 'platforms', 'skills', 'verify', 'harvest', 'view']);
  let cmd = 'doctor';
  const rest = [];
  if (args.length && commands.has(args[0])) { cmd = args[0]; rest.push(...args.slice(1)); } else rest.push(...args);

  const flags = { platform: [], blame: [] };
  for (const a of rest) {
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    const val = eq > 0 ? a.slice(eq + 1) : true;
    if (name === 'platform' || name === 'blame') flags[name].push(val);
    else flags[name] = val;
  }
  return { cmd, flags };
}

// ---------- redaction ----------
// --redact-paths has to catch more than filesystem paths: projectKey slugs embed the OS
// username (C--Users-<name>-...) without being paths, so displayPath alone misses them.
// Over-redacting is the safe direction for anything headed into an issue report.
function makeRedactor() {
  let user = null;
  try { user = userInfo().username; } catch { /* not available on every platform */ }
  if (user && user.length < 3) user = null;
  return (v) => {
    let out = String(v);
    if (out === HOME) return '~';
    if (out.startsWith(HOME + '\\') || out.startsWith(HOME + '/')) out = '~' + out.slice(HOME.length);
    if (user) out = out.split(user).join('<user>');
    return out;
  };
}

function redactDeep(value, scrub) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, scrub));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, scrub)]));
  }
  return value;
}

const maybeRedact = (obj, flags) => (flags['redact-paths'] ? redactDeep(obj, makeRedactor()) : obj);

// ---------- report ----------
function buildReport(scan, findings, ms) {
  return {
    schema: 1,
    generatedAt: scan.scannedAt,
    host: scan.host,
    roots: resolveRoots(),
    elapsedMs: ms,
    scanned: {
      rootsScanned: scan.rootsScanned,
      shapeHits: scan.shapeHits,
      platformsInstalled: scan.platforms.filter((p) => p.installed).length,
      platformsWithMemory: scan.platforms.filter((p) => p.status.startsWith('detected')).length,
      notes: scan.platforms.reduce((a, p) => a + p.notes, 0),
    },
    summary: summarize(findings),
    findings,
  };
}

function applyFilters(findings, flags) {
  let out = findings;
  if (flags.platform.length) out = out.filter((f) => flags.platform.includes(f.platform));
  if (flags.blame.length) out = out.filter((f) => flags.blame.includes(CATALOG[f.id].blame));
  return out;
}

function locStr(f) {
  const bits = [];
  if (f.platform) bits.push(f.platform);
  if (f.scope) bits.push(f.scope === 'user' ? t('scope.user') : f.projectKey ? t('scope.project', { key: f.projectKey }) : f.scope);
  return bits.join(' · ');
}

// ---------- text renderer ----------
const SEV_COLOR = { high: '31', medium: '33', low: '36', info: '90' };
const blameLabel = (b) => t('blame.' + b);

function makeColor(flags) {
  const on = process.stdout.isTTY && !flags['no-color'];
  return (code, s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
}

function renderText(report, flags) {
  const c = makeColor(flags);
  const L = [];
  const s = report.scanned;
  L.push(c('1', 'ai-memlint doctor') + c('90', `  ·  ${report.generatedAt}`));
  L.push(c('90', t('doctor.scan', {
    roots: s.rootsScanned, shapes: s.shapeHits, installed: s.platformsInstalled,
    withMemory: s.platformsWithMemory, notes: s.notes, ms: report.elapsedMs,
  })));
  L.push(c('90', t('doctor.dataRoot', { path: report.roots.data }) + (report.roots.overridden ? t('doctor.dataRootOverride') : '')));
  L.push('');

  const sev = report.summary.bySeverity;
  if (!report.findings.length) {
    L.push(c('32', t('doctor.clean')));
    return L.join('\n');
  }
  L.push(t('doctor.found', { total: c('1', String(report.summary.total)) }) + '   ' +
    SEVERITIES.map((x) => `${x} ${sev[x] ? c(SEV_COLOR[x], String(sev[x])) : c('90', '0')}`).join(' · '));
  const bl = report.summary.byBlame;
  L.push(c('90', t('doctor.byBlame', { userData: bl['user-data'], descriptor: bl.descriptor, platform: bl.platform })));

  const byBlame = partitionByBlame(report.findings);
  for (const b of BLAMES) {
    const items = byBlame[b === 'user-data' ? 'userData' : b === 'descriptor' ? 'descriptor' : 'platform'];
    if (!items.length) continue;
    const label = blameLabel(b);
    L.push('');
    L.push(c('90', `── ${label} ${'─'.repeat(Math.max(0, 40 - label.length))}`));
    for (const f of items) {
      const meta = CATALOG[f.id];
      L.push(`${c(SEV_COLOR[meta.severity], `[${meta.severity}]`)} ${c('1', meta.title)}${f.count > 1 ? c('90', ` ×${f.count}`) : ''}`);
      const loc = locStr(f);
      if (loc) L.push(c('90', `       ${loc}`));
      if (f.subject) L.push(`       ${f.subject}`);
      if (f.path && f.path !== f.subject) L.push(c('90', `       ${f.path}`));
      L.push(c('90', `       → ${renderFix(f)}`));
    }
  }
  L.push('');
  return L.join('\n');
}

// ---------- exit code ----------
function exitCodeFor(findings, failOn) {
  if (failOn === 'never') return 0;
  const threshold = failOn === 'any' ? SEVERITIES.length - 1 : SEVERITY_ORDER[failOn] ?? SEVERITY_ORDER.high;
  const hit = findings.some((f) => SEVERITY_ORDER[CATALOG[f.id].severity] <= threshold);
  return hit ? 1 : 0;
}

// ---------- commands ----------
function runDoctor(flags) {
  const dataBefore = snapshotDir(DATA_ROOT);
  const t0 = Date.now();
  const scan = probeAll();
  const prev = existsSync(STATE_PATH) ? safeJson(STATE_PATH) : null;
  const findings = applyFilters(collect(scan, { prevNotes: prev?.notes ?? null }), flags);
  const report = buildReport(scan, findings, Date.now() - t0);

  // The headline claim, checked rather than asserted: doctor must not touch the data root.
  const dataAfter = snapshotDir(DATA_ROOT);
  report.zeroWrite = sameSnapshot(dataBefore, dataAfter);

  const view = maybeRedact(report, flags);
  if (flags.json) process.stdout.write(JSON.stringify(view, null, 2) + '\n');
  else {
    process.stdout.write(renderText(view, flags) + '\n');
    if (!report.zeroWrite) process.stdout.write(makeColor(flags)('31', t('doctor.zeroWriteWarning') + '\n'));
  }

  if (flags.out) {
    const target = flags.out === true ? REPORT_PATH : String(flags.out);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(view, null, 2));
    process.stdout.write(makeColor(flags)('90', t('common.reportTo', { path: displayPath(target) }) + '\n'));
  }

  if (flags.view) return runView(flags);
  return exitCodeFor(findings, flags['fail-on'] ?? 'high');
}

function runPlatforms(flags) {
  const scan = probeAll();
  const rows = scan.platforms.map((p) => ({
    id: p.id, label: p.label, family: p.family, custom: !!p.custom,
    installed: !!p.installed, status: p.status, notes: p.notes,
    declaredRoots: (p.declaredRoots ?? []).map((r) => displayPath(r)),
    presentRoots: (p.roots ?? []).map((r) => displayPath(r)),
    memoryScopes: p.stores.map((s) => ({ scope: s.scope, dir: displayPath(s.dir), notes: s.notes.length, index: s.indexName })),
    note: p.descriptorNote,
  }));

  const out = maybeRedact({ schema: 1, platforms: rows, customError: scan.customError }, flags);
  if (flags.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return 0; }

  const c = makeColor(flags);
  const nCustom = rows.filter((r) => r.custom).length;
  const summary = t('platforms.summary', { count: rows.length, installed: rows.filter((r) => r.installed).length })
    + (nCustom ? t('platforms.summaryCustom', { n: nCustom }) : '');
  const L = [c('1', 'ai-memlint platforms') + c('90', `  ·  ${summary}`), ''];
  if (out.customError) L.push(c('33', out.customError), '');
  for (const r of out.platforms) {
    const badge = r.installed ? (r.notes ? c('32', r.status) : c('90', r.status)) : c('90', r.status);
    L.push(`${r.installed ? c('32', '●') : c('90', '○')} ${r.custom ? c('36', t('platforms.customBadge')) : ''}${r.label.padEnd(14)} ${badge.padEnd(28)} ${c('90', r.id)}`);
    L.push(c('90', t('platforms.declared', { roots: r.declaredRoots.join('  ') })));
    if (r.memoryScopes.length) {
      L.push(c('90', t('platforms.memory', {
        scopes: r.memoryScopes.map((m) => `${m.scope}=${m.dir} [${m.notes}${m.index ? ', idx:' + m.index : ''}]`).join('  '),
      })));
    }
    if (r.notes) L.push(c('90', t('platforms.local', { roots: r.presentRoots.join('  '), notes: r.notes })));
    if (r.note) L.push(c('90', t('platforms.note', { note: r.note })));
  }
  L.push('');
  process.stdout.write(L.join('\n') + '\n');
  return 0;
}

// ---------- skills ----------
const kb = (n) => (n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`);
const clip = (s, n) => (!s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s);

function skillRows(scan) {
  return scan.skills.map((s) => ({
    platform: s.platform, rootRel: s.rel.split(/[\\/]/)[0], rel: s.rel, dir: displayPath(s.dir),
    name: s.name, manifestName: s.manifestName, description: s.description,
    bytes: s.bytes, hash: s.hash, level: s.level, rules: s.rules,
  }));
}

function targetRows(scan) {
  return skillTargets(scan).map((t) => ({
    key: t.key, label: t.label, kind: t.kind, installable: t.installable,
    platform: t.platform, rel: t.rel, dir: displayPath(t.dir), skills: t.skills,
  }));
}

function runSkills(flags) {
  const c = makeColor(flags);
  const scan = probeAll({ skills: true });
  const to = typeof flags.to === 'string' ? flags.to : null;
  const from = typeof flags.from === 'string' ? flags.from : null;
  const labels = new Map(scan.platforms.map((p) => [p.id, p.label]));

  if (to || from) {
    const r = migrationReport(scan, to, from);
    if (r.error) {
      process.stderr.write(`ai-memlint: ${r.error}\n`);
      const keys = skillTargets(scan).filter((x) => !to || x.installable).map((x) => `  ${x.key}${x.installable ? '' : t('skills.sourceOnlyTag')}`);
      process.stdout.write(c('90', t('platforms.choices') + '\n' + keys.join('\n') + '\n'));
      return 2;
    }
    const out = maybeRedact({ schema: 1, ...r }, flags);
    if (flags.json) {
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      if (flags.out) writeOut(out, flags, c, SKILLS_REPORT_PATH);
      return 0;
    }

    const L = [c('1', t('skills.migrateTitle')) + c('90', `  ·  ${out.generatedAt}`), ''];
    L.push(t('skills.target', { label: c('1', out.target.label), rel: c('90', out.target.rel), count: out.target.skills }));
    if (out.source) L.push(t('skills.source', { label: c('1', out.source.label), rel: c('90', out.source.rel) }));
    L.push(c('90', t('skills.counts', out.counts)));
    for (const p of out.prepare) L.push(c('33', t('skills.prepare', { cmd: p })));
    L.push('');

    const HEAD = { missing: ['skills.state.missing', '33'], conflict: ['skills.state.conflict', '31'], same: ['skills.state.same', '90'] };
    let last = null;
    for (const i of out.items) {
      if (i.state !== last) { L.push(c('90', `── ${t(HEAD[i.state][0])} ──`)); last = i.state; }
      const [key, col] = HEAD[i.state];
      L.push(`${c(col, `[${t(key)}]`)} ${c('1', i.name)}${i.copies > 1 ? c('90', t('skills.copies', { n: i.copies })) : ''}`);
      L.push(c('90', t('skills.from', { rel: i.chosen.rel, hash: i.chosen.hash.slice(0, 8), size: kb(i.chosen.bytes) }) + (i.chosen.level === 'clean' ? '' : '  ' + i.chosen.level)));
      if (i.current) L.push(c('90', t('skills.current', { rel: i.current.rel, hash: i.current.hash.slice(0, 8) })));
      for (const w of i.warnings) L.push(c('33', `       ! ${w}`));
      if (i.command) L.push(`       ${c('32', '$')} ${i.command}`);
    }
    L.push('', c('90', out.note), '');
    process.stdout.write(L.join('\n') + '\n');
    if (flags.out) writeOut(out, flags, c, SKILLS_REPORT_PATH);
    return 0;
  }

  let rows = skillRows(scan);
  if (flags.platform.length) rows = rows.filter((r) => flags.platform.includes(r.platform ?? r.rootRel));
  const out = maybeRedact({ schema: 1, generatedAt: scan.scannedAt, count: rows.length, targets: targetRows(scan), skills: rows }, flags);
  if (flags.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    if (flags.out) writeOut(out, flags, c, SKILLS_REPORT_PATH);
    return 0;
  }

  const L = [c('1', 'ai-memlint skills') + c('90', `  ·  ${t('skills.inventorySummary', { count: out.count, dirs: out.targets.length })}`), ''];
  const installable = out.targets.filter((x) => x.installable);
  const rest = out.targets.filter((x) => !x.installable);
  // The unit lives in the locale ('{n} 个' / '{n}') so the padded column survives translation.
  const trow = (x) => `  ${clip(x.key === x.rel ? x.rel : `${x.key} · ${x.rel}`, 60).padEnd(60)} ${t('skills.unit', { n: String(x.skills).padStart(3) })}`;
  L.push(c('90', t('skills.targetsHeading')));
  for (const x of installable) L.push(trow(x));
  if (rest.length) {
    L.push('', c('90', t('skills.sourceOnlyHeading')));
    for (const x of rest) L.push(trow(x));
  }

  const groups = new Map();
  for (const r of out.skills) {
    const k = r.platform ?? r.rootRel;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, list] of [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
    L.push('', c('90', `── ${labels.get(k) ?? k} · ${list.length} ──`));
    for (const r of list) {
      const flag = r.level === 'clean' ? '' : c('31', ` [${r.level}]`);
      L.push(`  ${clip(r.name, 34).padEnd(34)} ${c('90', r.hash.slice(0, 8))} ${c('90', kb(r.bytes).padStart(8))}${flag}`);
      if (r.manifestName && r.manifestName !== r.name) L.push(c('33', `      frontmatter name: ${r.manifestName}`));
      if (r.description) L.push(c('90', `      ${clip(r.description, 88)}`));
      L.push(c('90', `      ${r.rel}`));
    }
  }
  L.push('', c('90', t('skills.footer')), '');
  process.stdout.write(L.join('\n') + '\n');
  if (flags.out) writeOut(out, flags, c, SKILLS_REPORT_PATH);
  return 0;
}

function writeOut(payload, flags, c, fallback) {
  const target = flags.out === true ? fallback : String(flags.out);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(payload, null, 2));
  process.stdout.write(c('90', t('common.reportTo', { path: displayPath(target) }) + '\n'));
}

// ---------- verify ----------
function runVerify(flags) {
  const c = makeColor(flags);
  const result = runAssertions();
  const ok = (b) => (b ? c('32', t('verify.pass')) : c('31', t('verify.fail')));
  const out = maybeRedact(result, flags);
  if (flags.json) { process.stdout.write(JSON.stringify(out, null, 2) + '\n'); return result.pass ? 0 : 1; }

  const L = [c('1', 'ai-memlint verify') + c('90', `  ·  ${t('verify.sourceFiles', { n: result.sourceFiles })}`), ''];
  const A = out.assertions;
  const D = A.zeroDependencies;
  L.push(`${ok(D.pass)}  ${t('verify.zeroDeps', {
    pkg: D.packageJson ? t('verify.pkgWithDeps', { n: D.declaredDependencies.length }) : t('verify.pkgNone'),
    nm: D.nodeModules ? t('verify.yes') : t('verify.no'),
    ext: D.externalImports.length,
  })}`);
  if (D.parseError) L.push(c('31', t('verify.parseError', { err: D.parseError })));
  const N = A.zeroNetworkEgress;
  L.push(`${ok(N.pass)}  ${t('verify.zeroEgress', {
    node: N.nodeEgress.length,
    origins: N.externalOrigins.length,
    listens: N.listenBindings.length,
    loopback: N.listenBindings.length ? t('verify.loopback') : '',
  })}`);
  L.push(`${ok(A.deleteCalls.pass)}  ${t('verify.deleteCalls', { n: A.deleteCalls.hits.length })}`);
  L.push(t('verify.writeCalls', { n: A.writeCalls.count }));
  L.push(`${ok(A.sourceIntegrity.pass)}  ${t('verify.integrity', {
    files: A.sourceIntegrity.files,
    state: A.sourceIntegrity.identical ? t('verify.identical') : t('verify.changed'),
  })}`);
  L.push(`${ok(A.doctorZeroWrite.pass)}  ${t('verify.zeroWrite', {
    state: A.doctorZeroWrite.dataRootExisted ? t('verify.unchanged') : t('verify.notCreated'),
  })}`);

  for (const [label, hits] of [[t('verify.ev.nodeEgress'), N.nodeEgress], [t('verify.ev.origins'), N.externalOrigins], [t('verify.ev.listens'), N.listenBindings], [t('verify.ev.deletes'), A.deleteCalls.hits], [t('verify.ev.writes'), A.writeCalls.hits]]) {
    if (!hits.length) continue;
    L.push('', c('90', `  ${label}:`));
    for (const h of hits) L.push(c('90', `    ${h.file}:${h.line}  ${h.text}`));
  }
  if (A.sourceIntegrity.changed.length) {
    L.push('', c('31', t('verify.changedFiles')));
    for (const p of A.sourceIntegrity.changed) L.push(c('31', `    ${displayPath(p)}`));
  }
  L.push('', c('90', t('verify.note')), '');
  process.stdout.write(L.join('\n') + '\n');
  return result.pass ? 0 : 1;
}

// ---------- delegated commands ----------
function runHarvest(flags) {
  const passthrough = flags['dry-run'] ? ['--dry-run'] : [];
  if (existsSync(join(LEGACY_ROOT, 'state.json')) && !existsSync(STATE_PATH)) {
    process.stdout.write(makeColor(flags)('90', `检测到旧数据根 ${displayPath(LEGACY_ROOT)}，harvest 会迁移 run 历史。\n`));
  }
  const child = spawn(process.execPath, [join(BIN, 'harvest.mjs'), ...passthrough], { stdio: 'inherit' });
  return new Promise((res) => child.on('close', (code) => res(code ?? 2)));
}

function runView(flags) {
  const child = spawn(process.execPath, [join(BIN, 'serve.mjs')], { stdio: ['inherit', 'pipe', 'inherit'] });
  let opened = false;
  child.stdout.on('data', (d) => {
    process.stdout.write(d);
    if (opened || flags['no-open']) return;
    const m = /(http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{32})/.exec(String(d));
    if (m) { opened = true; openBrowser(m[1]); }
  });
  process.on('SIGINT', () => { child.kill('SIGINT'); process.exit(0); });
  return new Promise((res) => child.on('close', (code) => res(code ?? 0)));
}

function openBrowser(url) {
  // Only ever open a loopback URL we generated ourselves.
  if (!/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{32}$/.test(url)) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* no browser is not an error */ }
}

function safeJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }

// ---------- main ----------
const { cmd, flags } = parseArgs(process.argv);
if (flags.lang !== undefined) {
  const want = String(flags.lang).toLowerCase();
  if (!localeNames.includes(want)) {
    process.stderr.write(`ai-memlint: unknown --lang=${flags.lang}; expected ${localeNames.join('|')}\n`);
    process.exit(2);
  }
  setLocale(want);
}
if (flags.help) { process.stdout.write(usage() + '\n'); process.exit(0); }
try {
  const code = await (cmd === 'doctor' ? runDoctor(flags)
    : cmd === 'platforms' ? runPlatforms(flags)
      : cmd === 'skills' ? runSkills(flags)
        : cmd === 'verify' ? runVerify(flags)
          : cmd === 'harvest' ? runHarvest(flags)
            : cmd === 'view' ? runView(flags)
              : 2);
  process.exitCode = code;
} catch (e) {
  process.stderr.write(`ai-memlint: ${e?.stack || e}\n`);
  process.exitCode = 2;
}
