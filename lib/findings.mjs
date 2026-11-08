// Findings layer. CATALOG holds static display metadata; collect() derives instances
// from probe facts. Instances carry data only — every word a user reads lives in
// CATALOG or in a renderer, so adding a language never touches the probe.
//
// severity = urgency of action, not danger level:
//   high   act now (credential exposure, or memory that silently never gets retrieved)
//   medium should act
//   low    optional / contributor-relevant
//   info   statement of state, no action implied
// blame decides who the issue is filed against:
//   user-data  the user's own memory needs cleanup
//   descriptor this tool's registry is stale or incomplete -> PR
//   platform   the vendor's format or files are the cause
export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3 };
export const SEVERITIES = ['high', 'medium', 'low', 'info'];
export const BLAMES = ['user-data', 'descriptor', 'platform'];

import { t } from './i18n.mjs';

// Structural metadata is locale-free; only the prose moves into lib/locales/*.
const META = {
  'credential-plaintext': { kind: 'security', severity: 'high', blame: 'user-data' },
  'credential-sensitive': { kind: 'security', severity: 'medium', blame: 'user-data' },
  'orphan-note': { kind: 'correctness', severity: 'high', blame: 'user-data' },
  'note-unreadable': { kind: 'correctness', severity: 'medium', blame: 'platform' },
  'index-dangling-link': { kind: 'correctness', severity: 'medium', blame: 'user-data' },
  'conflict-cross-platform': { kind: 'correctness', severity: 'medium', blame: 'user-data' },
  'frontmatter-missing': { kind: 'hygiene', severity: 'low', blame: 'user-data' },
  'descriptor-gap': { kind: 'descriptor', severity: 'low', blame: 'descriptor' },
  'shape-unattributed': { kind: 'descriptor', severity: 'low', blame: 'descriptor' },
  'index-missing': { kind: 'descriptor', severity: 'low', blame: 'descriptor' },
  'memory-empty': { kind: 'hygiene', severity: 'info', blame: 'platform' },
  'index-header-mismatch': { kind: 'descriptor', severity: 'info', blame: 'descriptor' },
  'note-vanished': { kind: 'hygiene', severity: 'info', blame: 'user-data' },
};

// title/fix are derived, not static: they resolve through the active locale on every read,
// so setLocale() takes effect without rebuilding the catalog, and every existing
// `CATALOG[f.id].title` call site keeps working unchanged.
export const CATALOG = Object.fromEntries(Object.entries(META).map(([id, meta]) => [id, {
  ...meta,
  get title() { return t(`finding.${id}.title`); },
  get fix() { return t(`finding.${id}.fix`); },
}]));

export function collect(scan, { prevNotes = null } = {}) {
  const out = [];
  const add = (id, o) => out.push({ id, count: 1, ...o });

  for (const p of scan.platforms) {
    if (!p.installed) continue;
    for (const s of p.stores) {
      const loc = { platform: p.id, scope: s.scope, projectKey: s.projectKey ?? null };

      for (const n of s.notes) {
        if (n.level === 'secret-value') {
          add('credential-plaintext', { ...loc, subject: n.file, path: n.path, evidence: { rules: n.rules, marks: n.marks ?? [] } });
        } else if (n.level === 'sensitive') {
          add('credential-sensitive', { ...loc, subject: n.file, path: n.path, evidence: { rules: n.rules, marks: n.marks ?? [] } });
        }
        if (n.orphaned) {
          add('orphan-note', {
            ...loc, subject: n.file, path: n.path,
            evidence: { slug: n.slug, index: s.index.file ?? null },
          });
        }
      }

      for (const u of s.unreadable) {
        add('note-unreadable', { ...loc, subject: u.file, path: u.path, evidence: { error: u.error } });
      }

      if (s.index.present) {
        const dangling = s.index.dangling ?? [];
        if (dangling.length) {
          add('index-dangling-link', {
            ...loc, subject: s.index.file, path: s.index.path ?? null,
            count: dangling.length, evidence: { items: dangling, index: s.index.file },
          });
        }
        if (s.index.headerDrift) {
          add('index-header-mismatch', {
            ...loc, subject: s.index.file, path: s.index.path ?? null,
            evidence: { expected: s.index.expectedHeader ? '有 header' : '无 header', actual: s.index.hasHeader ? '有 header' : '无 header' },
          });
        }
      } else if (s.indexExpected && s.notes.length) {
        add('index-missing', {
          ...loc, subject: s.dir, path: s.dir,
          count: s.notes.length, evidence: { index: s.indexName ?? null },
        });
      }

      if (s.frontmatterExpected) {
        const missing = s.notes.filter((n) => !n.hasFrontmatter);
        if (missing.length) {
          add('frontmatter-missing', {
            ...loc, subject: s.dir, path: s.dir,
            count: missing.length, evidence: { items: missing.map((n) => n.slug) },
          });
        }
      }

      // Project-scope memory dirs are pre-created empty by the platforms, so reporting
      // them floods the report; an empty *user* scope is the only signal here.
      if (s.scope === 'user' && s.notes.length === 0 && !s.unreadable.length) {
        add('memory-empty', { ...loc, subject: s.dir, path: s.dir, evidence: {} });
      }
    }
  }

  for (const c of scan.conflicts ?? []) {
    add('conflict-cross-platform', {
      platform: null, scope: c.scope, projectKey: c.projectKey ?? null,
      subject: c.slug, path: null,
      evidence: { owners: c.owners, hashes: c.hashes },
    });
  }

  for (const g of scan.descriptorGaps ?? []) {
    add('descriptor-gap', { platform: g.platform, scope: null, projectKey: null, subject: g.rel, path: g.path, evidence: {} });
  }

  for (const u of scan.unknown ?? []) {
    add('shape-unattributed', {
      platform: null, scope: null, projectKey: null, subject: u.rel, path: u.path,
      evidence: { shape: u.shape, kind: u.kind },
    });
  }

  if (prevNotes) {
    const seen = new Set(scan.seenKeys ?? []);
    const gone = Object.entries(prevNotes).filter(([k]) => !seen.has(k));
    if (gone.length) {
      add('note-vanished', {
        platform: null, scope: null, projectKey: null, subject: null, path: null,
        count: gone.length,
        evidence: { items: gone.map(([, v]) => `${v.scope === 'user' ? 'user' : v.projectKey}/${v.slug}.md`) },
      });
    }
  }

  return sort(out);
}

function sort(findings) {
  return findings.sort((a, b) => {
    const s = SEVERITY_ORDER[CATALOG[a.id].severity] - SEVERITY_ORDER[CATALOG[b.id].severity];
    if (s) return s;
    const bl = BLAMES.indexOf(CATALOG[a.id].blame) - BLAMES.indexOf(CATALOG[b.id].blame);
    if (bl) return bl;
    return String(a.subject ?? '').localeCompare(String(b.subject ?? ''));
  });
}

export function summarize(findings) {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  const byBlame = Object.fromEntries(BLAMES.map((b) => [b, 0]));
  const byKind = {};
  const byPlatform = {};
  for (const f of findings) {
    const c = CATALOG[f.id];
    bySeverity[c.severity]++;
    byBlame[c.blame]++;
    byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
    if (f.platform) byPlatform[f.platform] = (byPlatform[f.platform] ?? 0) + 1;
  }
  return { total: findings.length, bySeverity, byBlame, byKind, byPlatform };
}

// Findings whose blame is 'descriptor' are this repo's problem, not the user's data.
// Splitting them out is what keeps an issue tracker actionable.
export function partitionByBlame(findings) {
  return {
    userData: findings.filter((f) => CATALOG[f.id].blame === 'user-data'),
    descriptor: findings.filter((f) => CATALOG[f.id].blame === 'descriptor'),
    platform: findings.filter((f) => CATALOG[f.id].blame === 'platform'),
  };
}

// Template fill. Unknown placeholders are left intact so a bad template is visible
// rather than silently rendering as 'undefined'.
export function renderFix(f) {
  const tpl = CATALOG[f.id].fix;
  const marks = (f.evidence?.marks ?? []).map((m) => `${m.rule}@L${m.line}`);
  const vars = {
    subject: f.subject ?? '—',
    count: String(f.count ?? 1),
    platform: f.platform ?? '—',
    ...(f.evidence ?? {}),
    // Rendered after the evidence spread on purpose: templates want the readable
    // 'rule@L12' form, while renderers that highlight lines read evidence.marks raw.
    marks: marks.join(', ') || (f.evidence?.rules ?? []).join(', '),
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars[k];
    if (v === undefined) return m;
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}
