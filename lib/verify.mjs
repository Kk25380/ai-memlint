// Trust assertions. Extracted from the CLI so the web layer reports the same evidence
// rather than a second, drifting copy of it.
//
// These are measurements, not declarations: every claim is re-derived from the source tree
// and from two live probe passes on each call.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { probeAll } from './probe.mjs';
import { CODE_ROOT, DATA_ROOT, displayPath } from './paths.mjs';

// Node-side egress. Scanned only in .mjs/.js: a browser-side fetch('/api/...') in
// index.html is same-origin to loopback and is not egress, so counting it would be a
// false positive that trains people to ignore this assertion.
const NODE_EGRESS = /\bfetch\s*\(|\b(?:https?|net|dgram|dns)\.(?:request|get|post|connect|createConnection|lookup|resolve)\s*\(|\b(?:axios|XMLHttpRequest|WebSocket)\b/g;
// Any absolute http(s) origin anywhere, including the frontend. Loopback is allowed.
const EXTERNAL_ORIGIN = /https?:\/\/[^'"`\s)]+/g;
const LOOPBACK_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/;
const LISTEN = /\.listen\s*\(/g;
const DELETES = /\b(rmSync|unlinkSync|rmdirSync|rm|unlink|rmdir)\s*\(/g;
const WRITES = /\b(writeFileSync|appendFileSync|createWriteStream|mkdirSync)\s*\(/g;
const IMPORTS = /(?:^|\n)\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;

// Comments are not executed, and a pattern-definition line is not a call site. Skipping
// both is what stops the verifier from matching its own source.
const NOT_CODE = /^\s*(?:\/\/|\*|\/\*)/;
const PATTERN_DEF = /^\s*(?:const|let|var)\s+\w+\s*=\s*(?:new\s+RegExp|\/)/;

export function sourceFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = statSync(p);
      if (st.isDirectory()) { if (e !== 'node_modules' && e !== '.git' && e !== 'store') walk(p); }
      else if (/\.(mjs|js|html)$/.test(e)) out.push(p);
    }
  };
  walk(CODE_ROOT);
  return out;
}

export function grepSources(files) {
  const egress = [], origins = [], listens = [], deletes = [], writes = [], externals = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = relative(CODE_ROOT, f);
    const isNode = /\.m?js$/.test(f);
    const scan = (re, sink, filter) => {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const line = text.slice(0, m.index).split('\n').length;
        const src = text.split('\n')[line - 1].trim();
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (NOT_CODE.test(src) || PATTERN_DEF.test(src)) continue;
        const entry = { file: rel, line, text: src.slice(0, 120), match: m[0] };
        if (!filter || filter(entry)) sink.push(entry);
      }
    };
    if (isNode) scan(NODE_EGRESS, egress);
    scan(EXTERNAL_ORIGIN, origins, (e) => !LOOPBACK_ORIGIN.test(e.match));
    scan(LISTEN, listens);
    scan(DELETES, deletes);
    scan(WRITES, writes);
    IMPORTS.lastIndex = 0;
    let im;
    while ((im = IMPORTS.exec(text))) {
      const spec = im[1];
      if (!spec.startsWith('node:') && !spec.startsWith('.') && !spec.startsWith('/')) externals.push({ file: rel, spec });
      if (im[0].length === 0) IMPORTS.lastIndex++;
    }
  }
  return { egress, origins, listens, deletes, writes, externals };
}

export function snapshotDir(p) {
  if (!existsSync(p)) return null;
  const out = [];
  const walk = (d, prefix) => {
    for (const e of readdirSync(d)) {
      const fp = join(d, e);
      const rel = prefix ? `${prefix}/${e}` : e;
      if (statSync(fp).isDirectory()) walk(fp, rel);
      else out.push(`${rel}:${statSync(fp).size}`);
    }
  };
  walk(p, '');
  return out.sort().join('|');
}

export const sameSnapshot = (a, b) => a === b;

export function sourceIntegrity() {
  const paths = new Set();
  // Every file inside a probed store dir, not just the ones the descriptor matches —
  // .bak and unrecognized siblings must be covered too, or the invariant is partial.
  const grab = (scan) => {
    for (const p of scan.platforms) {
      for (const r of p.rules ?? []) for (const f of r.files ?? []) paths.add(join(r.path, f));
      for (const s of p.stores) {
        for (const n of s.notes) paths.add(n.path);
        if (s.index?.path) paths.add(s.index.path);
        for (const u of s.unreadable ?? []) paths.add(u.path);
        try { for (const e of readdirSync(s.dir)) paths.add(join(s.dir, e)); } catch { /* unreadable dir */ }
      }
    }
  };
  const sha = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return 'ERR'; } };
  const hashable = () => [...paths].filter((p) => existsSync(p) && statSync(p).isFile()).sort();

  const first = probeAll();
  grab(first);
  const list = hashable();
  const before = list.map(sha);

  const second = probeAll();
  grab(second);
  const list2 = hashable();
  const after = list2.map(sha);

  const identical = list.length === list2.length && before.every((h, i) => h === after[i]);
  return { files: list.length, identical, changed: identical ? [] : list.filter((p, i) => before[i] !== after[i]) };
}

// A package.json is metadata, not a dependency — it is what makes `npx ai-memlint` work.
// Asserting its absence conflated the two and would have blocked npm distribution forever.
// The narrower claim is still measured: no dependency field declares anything, there is no
// node_modules, and no source file imports a bare specifier.
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function readPackageJson() {
  const p = join(CODE_ROOT, 'package.json');
  if (!existsSync(p)) return { exists: false, json: null, parseError: null };
  try {
    return { exists: true, json: JSON.parse(readFileSync(p, 'utf8')), parseError: null };
  } catch (e) {
    // An unparseable manifest must fail the assertion, not silently count as "no dependencies".
    return { exists: true, json: null, parseError: e.message };
  }
}

export function runAssertions() {
  const files = sourceFiles();
  const g = grepSources(files);

  const pkg = readPackageJson();
  const declared = pkg.json ? DEP_FIELDS.flatMap((f) => Object.keys(pkg.json[f] ?? {})) : [];
  const deps = {
    packageJson: pkg.exists,
    parseError: pkg.parseError,
    declaredDependencies: declared,
    nodeModules: existsSync(join(CODE_ROOT, 'node_modules')),
    externalImports: g.externals,
  };
  const depsPass = !pkg.parseError && declared.length === 0 && !deps.nodeModules && g.externals.length === 0;

  const loopbackOnly = g.listens.every((l) => /127\.0\.0\.1|localhost/.test(l.text));
  const netPass = g.egress.length === 0 && g.origins.length === 0 && loopbackOnly;

  // sourceIntegrity already runs two full probe passes, so the zero-write snapshot wraps
  // them rather than paying for a third.
  const dataBefore = snapshotDir(DATA_ROOT);
  const integrity = sourceIntegrity();
  const zeroWrite = sameSnapshot(dataBefore, snapshotDir(DATA_ROOT));

  const result = {
    schema: 1,
    codeRoot: displayPath(CODE_ROOT),
    dataRoot: displayPath(DATA_ROOT),
    sourceFiles: files.length,
    assertions: {
      zeroDependencies: { pass: depsPass, ...deps },
      zeroNetworkEgress: { pass: netPass, nodeEgress: g.egress, externalOrigins: g.origins, listenBindings: g.listens },
      deleteCalls: { pass: g.deletes.length === 0, hits: g.deletes },
      writeCalls: { count: g.writes.length, hits: g.writes },
      sourceIntegrity: { pass: integrity.identical, ...integrity },
      doctorZeroWrite: { pass: zeroWrite, dataRootExisted: dataBefore !== null },
    },
  };
  result.pass = Object.values(result.assertions).every((a) => a.pass !== false);
  return result;
}
