// SKILL.md frontmatter parsing. Deliberately shallow: top-level `key: value` lines only.
// A skill manifest is untrusted input from arbitrary platforms, so this is a reader,
// never an evaluator — no code execution, no nested-YAML ambition.
export function parseManifest(text) {
  const out = { name: null, description: null, fields: [] };
  // Windows-authored manifests can carry a BOM, which would hide the `---` fence.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return out;
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    out.fields.push(kv[1]);
    let val = kv[2].trim().replace(/^["']|["']$/g, '');
    // `description: |` and `description: >` put the text on the following indented lines.
    if (/^[|>][+-]?$/.test(val)) {
      const body = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) body.push(lines[++i].trim());
      val = body.join(' ');
    }
    if (kv[1] === 'name' && !out.name) out.name = val;
    if (kv[1] === 'description' && !out.description) out.description = val;
  }
  return out;
}
