// Credential classifier. Runs on every note before it reaches the store.
// Levels: 'secret-value' (quarantine) | 'sensitive' (store, mask on render) | 'clean'
const RULES = [
  { id: 'pem-block', level: 'secret-value', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'openai-key', level: 'secret-value', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'aws-key', level: 'secret-value', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', level: 'secret-value', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'slack-token', level: 'secret-value', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'bearer', level: 'secret-value', re: /\bBearer\s+[A-Za-z0-9._-]{24,}/g },
  { id: 'conn-string', level: 'secret-value', re: /\b(?:mysql|postgres(?:ql)?|mongodb|redis|amqp):\/\/[^\s/@]*:[^\s/@]*@/gi },
  // 32-hex only counts as a secret with keyword context — bare hex is too noisy (hashes, ids)
  { id: 'hex32-secret', level: 'secret-value', re: /(?:appsecret|app secret|secret|密钥|口令|password|passwd)[^\n]{0,32}?\b([0-9a-f]{32})\b/gi, group: 1 },
  { id: 'private-key-file', level: 'sensitive', re: /\bprivate\.[A-Za-z0-9_-]+\.(?:key|pem)\b/g },
  // Requires a path separator: a bare `.key` also matches property access (t.key, bindings.key),
  // which flagged this tool's own source as sensitive. The bare `private.<x>.key` filename form
  // stays covered by private-key-file above, so no real key path is lost.
  { id: 'key-path', level: 'sensitive', re: /[A-Za-z0-9_./\\:-]*[\/\\][A-Za-z0-9_.-]*\.(?:key|pem|p12|pfx)\b/g },
  { id: 'wechat-appid', level: 'sensitive', re: /\bwx[0-9a-f]{16}\b/g },
  { id: 'uin', level: 'sensitive', re: /\bUIN[：:\s]+`?\d{6,14}/gi },
  { id: 'cloudbase-env', level: 'sensitive', re: /\b[a-z][a-z0-9]{1,12}-[a-z0-9]{17,21}\b/g },
  { id: 'cn-mobile', level: 'sensitive', re: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { id: 'id-card', level: 'sensitive', re: /(?<!\d)\d{17}[\dXx](?!\d)/g },
  { id: 'birthdate', level: 'sensitive', re: /(?:出生|生日|生辰)[^\n]{0,12}?(?:19|20)\d{2}[-/年.]\d{1,2}[-/月.]\d{1,2}/g },
];

const LEVELS = { clean: 0, sensitive: 1, 'secret-value': 2 };

// Line starts are computed once per text; hits then binary-search into them. Notes are
// small but a linear scan per hit would make classify() quadratic in the worst case.
function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (index) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: index - starts[lo] + 1 };
  };
}

export function classify(text) {
  const at = lineIndex(text);
  const hits = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      const value = rule.group ? m[rule.group] : m[0];
      hits.push({ rule: rule.id, level: rule.level, value, index: m.index, ...at(m.index) });
      if (m[0].length === 0) rule.re.lastIndex++;
    }
  }
  const level = hits.reduce((a, h) => (LEVELS[h.level] > LEVELS[a] ? h.level : a), 'clean');
  return { level, hits: dedupe(hits) };
}

function dedupe(hits) {
  const seen = new Set();
  return hits.filter((h) => {
    // Keyed on line as well as value: the same secret quoted on five lines is five
    // places the user has to fix, and the line markers are the point of carrying hits.
    const k = h.rule + '\u0000' + h.value + '\u0000' + h.line;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// Mask in place, preserving line structure so the note stays readable.
export function mask(text) {
  let out = text;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (full, ...rest) => {
      if (!rule.group) return `[redacted:${rule.id}]`;
      const g = rest[rule.group - 1];
      const idx = typeof g === 'string' ? full.indexOf(g) : -1;
      return idx > 0 ? full.slice(0, idx) + `[redacted:${rule.id}]` : `[redacted:${rule.id}]`;
    });
  }
  return out;
}

// Redaction report over a set of notes, for the health panel.
export function report(items) {
  const byLevel = { clean: 0, sensitive: 0, 'secret-value': 0 };
  const byRule = {};
  const exposed = [];
  for (const it of items) {
    byLevel[it.level]++;
    if (it.level !== 'clean') {
      exposed.push(it);
      for (const h of it.hits) byRule[h.rule] = (byRule[h.rule] ?? 0) + 1;
    }
  }
  return { byLevel, byRule, exposed };
}
