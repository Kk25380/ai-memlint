#!/usr/bin/env node
// Local read-only viewer for the ai-memlint audit.
//
// Bound to loopback; Host-validated against DNS rebinding; token-gated; no CORS.
// Every GET re-probes live and writes nothing — including /api/skills, whose migration
// checklist is text for the user to run. The only mutating endpoints are POST /api/harvest
// (materializes the opt-in store) and POST /api/custom (saves descriptors); both write
// inside the data root and never into a platform's own directory.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { probeAll } from '../lib/probe.mjs';
import { migrationReport, skillTargets } from '../lib/migrate.mjs';
import { CATALOG, collect, renderFix, summarize } from '../lib/findings.mjs';
import { classify, mask } from '../lib/redact.mjs';
import { runAssertions } from '../lib/verify.mjs';
import { CUSTOM_PATH, loadCustom, saveCustom } from '../lib/custom.mjs';
import { BIN, CODE_ROOT, DATA_ROOT, HOME, STATE_PATH, STORE, WEB_ROOT, displayPath, resolve as resolveRoots } from '../lib/paths.mjs';
import { LOCALES, locale as currentLocale } from '../lib/i18n.mjs';

const PORT = Number(process.env.PORT || 4371);
const TOKEN = randomBytes(16).toString('hex');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const HARVEST = resolve(BIN, 'harvest.mjs');
// Declared up front so an unknown path answers 404 and a known path with the wrong
// method answers 405, instead of everything falling through to one misleading code.
const API_PATHS = new Set(['/api/overview', '/api/verify', '/api/note', '/api/harvest', '/api/custom', '/api/skills']);

const json = (res, code, data) => {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
};

// Bounded: a descriptor list is a few KB at most, and an unbounded body reader on a
// loopback server is still an unbounded memory allocation.
function readBody(req, limit = 64 * 1024) {
  return new Promise((res, rej) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { rej(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return null; }
}

// Absolute paths carry the OS username. Scrubbed here, at the process boundary, so the
// browser never holds a string that could end up in a screenshot or a pasted issue.
function viewFinding(f) {
  const meta = CATALOG[f.id];
  const scrubbed = { ...f, subject: displayPath(f.subject), path: displayPath(f.path) };
  return { ...scrubbed, fix: renderFix(scrubbed), severity: meta.severity, kind: meta.kind, blame: meta.blame, title: meta.title };
}

function viewPlatform(p) {
  return {
    id: p.id, label: p.label, family: p.family, installed: p.installed, status: p.status,
    notes: p.notes,
    stores: p.stores.length,
    rules: p.rules.reduce((a, r) => a + r.files.length, 0),
    unreadable: p.stores.reduce((a, s) => a + s.unreadable.length, 0),
    scopes: p.stores.map((s) => ({ scope: s.scope, projectKey: s.projectKey, notes: s.notes.length, dir: displayPath(s.dir) })),
    roots: p.roots.map(displayPath),
    declaredRoots: (p.declaredRoots ?? []).map(displayPath),
    custom: !!p.custom,
    descriptorNote: p.descriptorNote,
  };
}

function overview() {
  const t0 = Date.now();
  const scan = probeAll();
  const state = loadState();
  const notes = state?.notes ?? null;
  const raw = collect(scan, { prevNotes: notes });
  const findings = raw.map(viewFinding);

  const rows = notes
    ? Object.entries(notes).map(([key, n]) => ({
        key, slug: n.slug, scope: n.scope, projectKey: n.projectKey, platform: n.platform,
        bytes: n.bytes, level: n.level, rules: n.rules, orphaned: n.orphaned,
        suppressed: !!n.suppressed,
        sources: (n.sources ?? []).map((s) => s.platform),
        type: n.frontmatter?.metadata?.type ?? null,
        description: n.frontmatter?.description ?? null,
        lastSeen: n.lastSeen,
      }))
    : [];

  const s = {
    rootsScanned: scan.rootsScanned,
    shapeHits: scan.shapeHits,
    platformsInstalled: scan.platforms.filter((p) => p.installed).length,
    platformsWithMemory: scan.platforms.filter((p) => p.status.startsWith('detected')).length,
    notes: scan.platforms.reduce((a, p) => a + p.notes, 0),
    conflicts: scan.conflicts.length,
    unknownHits: scan.unknown.length,
    descriptorGaps: scan.descriptorGaps.length,
  };

  return {
    schema: 2,
    scannedAt: scan.scannedAt,
    elapsedMs: Date.now() - t0,
    roots: Object.fromEntries(Object.entries(resolveRoots()).map(([k, v]) => [k, typeof v === 'string' ? displayPath(v) : v])),
    scanned: s,
    summary: summarize(raw),
    findings,
    platforms: scan.platforms.map(viewPlatform),
    store: {
      present: existsSync(STORE),
      materialized: !!notes,
      path: displayPath(STORE),
      dataRoot: displayPath(DATA_ROOT),
      notes: rows.length,
      suppressed: rows.filter((n) => n.suppressed).length,
      sensitive: rows.filter((n) => n.level === 'sensitive').length,
      orphaned: rows.filter((n) => n.orphaned).length,
      // Runs written before the audit inversion named these fields quarantined/conflicts.
      // Normalized here so every renderer sees one schema instead of each carrying a shim.
      runs: (state?.runs ?? []).slice(-12).reverse().map((r) => ({
        ...r,
        suppressed: r.suppressed ?? r.quarantined ?? 0,
        contested: r.contested ?? r.conflicts ?? 0,
      })),
    },
    notes: rows,
  };
}

function noteBody(key, wantBody) {
  const state = loadState();
  const n = state && Object.prototype.hasOwnProperty.call(state.notes ?? {}, key) ? state.notes[key] : null;
  if (!n) return { error: '该键不在 store 索引中', code: 404 };
  if (n.suppressed || !n.storePath) {
    const meta = {
      level: n.level, rules: n.rules, marks: n.marks ?? [],
      sources: (n.sources ?? []).map((s) => displayPath(s.srcPath)),
    };
    // The viewer runs in the user's own browser, so whether a suppressed body is
    // viewable at all is the user's choice, remembered there and sent per request.
    // Only mask(source) ever leaves this function; plaintext stays in its scope.
    if (wantBody) {
      const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
      const texts = (n.sources ?? []).map((s) => s.srcPath)
        .filter((p) => existsSync(p))
        .map((p) => [p, readFileSync(p, 'utf8')]);
      // marks were computed on the winner's text, so pick the source whose hash
      // matches the recorded one; line numbers stay aligned with what we return.
      const hit = texts.find(([, t]) => sha(t) === n.hash) ?? texts[0];
      if (!hit) return { error: '源文件已不存在，无法临时读取正文', code: 404, meta };
      return {
        text: mask(hit[1]), masked: true, live: true, level: n.level,
        rules: n.rules, marks: n.marks ?? [], meta: { ...meta, liveFrom: displayPath(hit[0]) },
      };
    }
    return {
      error: '该笔记含明文凭据，正文从未被复制到数据目录，默认不提供', code: 403,
      meta,
    };
  }

  const abs = resolve(n.storePath);
  if (!abs.startsWith(STORE + sep)) return { error: '路径越出 store', code: 403 };
  if (!existsSync(abs)) return { error: 'store 中无此文件，请重新物化', code: 404 };

  const stored = readFileSync(abs, 'utf8');
  const { level, hits } = classify(stored);
  // The store holds masked bodies by construction. A 'secret-value' hit here means the
  // file predates that rule, so it is refused rather than served — and that refusal is
  // the evidence that the invariant is being enforced, not assumed.
  if (level === 'secret-value') {
    return {
      error: 'store 副本仍含明文凭据（旧版本残留），已拒绝提供正文；重新物化即可覆盖', code: 403,
      meta: {
        level, rules: [...new Set(hits.map((h) => h.rule))],
        marks: [...new Map(hits.map((h) => [h.rule + '\u0000' + h.line, { rule: h.rule, line: h.line }])).values()],
        storePath: displayPath(abs),
      },
    };
  }
  // Masking removes the very tokens classify() looks for, so the stored copy now reads
  // 'clean'. The banner has to follow the *source* level recorded in state, otherwise the
  // reader sees [redacted:...] with no explanation of why.
  const masked = n.level !== 'clean';
  return {
    text: masked ? mask(stored) : stored,
    masked,
    level: n.level,
    rules: n.rules,
    marks: n.marks ?? [],
    meta: { ...n, storePath: displayPath(abs), sources: (n.sources ?? []).map((s) => ({ platform: s.platform, srcPath: displayPath(s.srcPath) })) },
  };
}

// Commands go to the browser as POSIX with $HOME, which expands inside double quotes
// (~ does not), so a copied line still runs in Git Bash while the payload never carries
// the OS username. The server prints them; it does not run them.
const shellPath = (p) => '$HOME/' + relative(HOME, p).split(sep).join('/');

const viewSkill = (s) => ({
  platform: s.platform, rel: s.rel, dir: displayPath(s.dir), name: s.name,
  manifestName: s.manifestName, description: s.description, bytes: s.bytes,
  hash: s.hash, level: s.level, rules: s.rules,
});

const viewRef = (s) => (s ? { ...s, dir: displayPath(s.dir) } : null);

function viewTarget(t) {
  return {
    key: t.key, label: t.label, kind: t.kind, installable: t.installable,
    platform: t.platform, rel: t.rel, dir: displayPath(t.dir), skills: t.skills,
  };
}

function skillsView(to, from) {
  const scan = probeAll({ skills: true });
  const targets = skillTargets(scan).map(viewTarget);
  if (!to) {
    return { mode: 'inventory', generatedAt: scan.scannedAt, count: scan.skills.length, targets, skills: scan.skills.map(viewSkill) };
  }
  const r = migrationReport(scan, to, from || null);
  if (r.error) return { mode: 'report', error: r.error, targets };
  return {
    mode: 'report', generatedAt: r.generatedAt, executed: r.executed, note: r.note, counts: r.counts,
    target: { ...r.target, dir: displayPath(r.target.dir) },
    source: r.source ? { ...r.source, dir: displayPath(r.source.dir) } : null,
    prepare: r.prepare.length ? [`mkdir -p "${shellPath(r.target.dir)}"`] : [],
    items: r.items.map((i) => ({
      ...i, chosen: viewRef(i.chosen), current: viewRef(i.current), sources: i.sources.map(viewRef),
      command: i.command ? `cp -r "${shellPath(i.chosen.dir)}" "${shellPath(r.target.dir)}"` : null,
    })),
    targets,
  };
}

function runHarvest() {
  return new Promise((res) => {
    const child = spawn(process.execPath, [HARVEST], { cwd: CODE_ROOT });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => res({ code, out }));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (!ALLOWED_HOSTS.has(req.headers.host)) {
    return json(res, 403, { error: 'host not allowed' });
  }

  if (url.pathname === '/') {
    // Only the web.* slice ships to the browser: the page has no use for the CLI's strings,
    // and a smaller payload keeps the page's own dictionary readable in devtools.
    const webDict = Object.fromEntries(
      Object.entries(LOCALES[currentLocale()]).filter(([k]) => k.startsWith('web.')),
    );
    const html = readFileSync(resolve(WEB_ROOT, 'index.html'), 'utf8')
      .replaceAll('__TOKEN__', TOKEN).replaceAll('__PORT__', String(PORT))
      .replaceAll('__I18N__', JSON.stringify(webDict).replace(/</g, '\\u003c'))
      .replaceAll('__LOCALE__', currentLocale());
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }

  if (!url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

  const token = url.searchParams.get('t') || req.headers['x-ai-memlint-token'];
  if (token !== TOKEN) return json(res, 401, { error: 'bad token' });

  if (!API_PATHS.has(url.pathname)) return json(res, 404, { error: 'not found' });

  try {
    if (req.method === 'GET' && url.pathname === '/api/overview') return json(res, 200, overview());
    if (req.method === 'GET' && url.pathname === '/api/verify') return json(res, 200, runAssertions());
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      return json(res, 200, skillsView(url.searchParams.get('to'), url.searchParams.get('from')));
    }
    if (req.method === 'GET' && url.pathname === '/api/note') {
      const r = noteBody(url.searchParams.get('key') ?? '', url.searchParams.get('body') === '1');
      return json(res, r.code ?? 200, r);
    }
    if (req.method === 'GET' && url.pathname === '/api/custom') {
      const c = loadCustom();
      return json(res, 200, { platforms: c.platforms, error: c.error, path: displayPath(CUSTOM_PATH) });
    }
    if (req.method === 'POST' && url.pathname === '/api/custom') {
      let text;
      try { text = await readBody(req); } catch (e) { return json(res, 413, { error: e.message }); }
      let list;
      try { list = JSON.parse(text || '{}').platforms; } catch { return json(res, 400, { error: 'body 不是合法 JSON' }); }
      try {
        const saved = saveCustom(list);
        return json(res, 200, { saved: saved.length, platforms: saved, overview: overview() });
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (req.method === 'POST' && url.pathname === '/api/harvest') {
      const r = await runHarvest();
      return json(res, 200, { harvest: r, overview: overview() });
    }
    return json(res, 405, { error: 'method not allowed' });
  } catch (e) {
    return json(res, 500, { error: e?.message || 'internal error' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n端口 ${PORT} 已被占用 — 很可能已有一个 viewer 在运行。`);
    console.error(`  换端口启动: PORT=4399 node bin/serve.mjs\n`);
    process.exit(2);
  }
  console.error(`ai-memlint viewer: ${e?.message || e}\n`);
  process.exit(2);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nai-memlint viewer`);
  console.log(`  http://127.0.0.1:${PORT}/?t=${TOKEN}`);
  console.log(`\n  仅绑定 loopback；校验 Host 头防 DNS rebinding；无 CORS；GET 无副作用。`);
  console.log(`  数据根 ${displayPath(DATA_ROOT)}${existsSync(STORE) ? '' : '（store 尚未物化，笔记页不可用）'}\n`);
});
