// English — the base locale. Every key here must exist in every other locale;
// test/i18n.test.mjs enforces key parity, so a missing translation fails the suite rather
// than silently rendering English in the middle of another language.
export default {
  // ---- shared ----
  'blame.user-data': 'your data — needs cleanup',
  'blame.descriptor': "this tool's descriptor — PR welcome",
  'blame.platform': 'platform behaviour',
  'scope.user': 'user',
  'scope.project': 'project/{key}',
  'common.reportTo': 'report -> {path}',

  // ---- usage ----
  'cli.usage': `ai-memlint — read-only AI-memory auditor

Usage: ai-memlint [command] [options]

Commands:
  doctor       scan and report findings (default; writes nothing)
  platforms    what the registry declares, and what matched on this machine
  skills       skill inventory; add --to for a migration checklist (prints, never runs)
  verify       trust surface: zero deps / zero egress / delete calls / source integrity
  harvest      materialize a readable store (the only command that writes by default)
  view         start the loopback viewer and open a browser

Options:
  --json               emit the report as JSON
  --platform=<id>      only report this platform (repeatable)
  --blame=<x>          only report this blame: user-data | descriptor | platform (repeatable)
  --to=<target>        skills: migration target (platform id or skill directory)
  --from=<source>      skills: only count that source dir; default is every other dir
  --fail-on=<sev>      exit-code threshold, default high: medium|low|any|never
  --redact-paths       rewrite the home directory to ~ (before pasting into an issue)
  --lang=<en|zh>       output language; default follows AI_MEMLINT_LANG, then the OS locale
  --out[=<path>]       doctor/skills: write the report to a file; bare --out uses the default
                       (platforms/verify ignore this option)
  --no-color           disable ANSI colour
  --no-open            do not open a browser for view
  --dry-run            harvest dry run, writes nothing
  --help               show this help

Exit codes: 0 no finding at or above the threshold · 1 some · 2 tool error`,

  // ---- doctor ----
  'doctor.scan': '{roots} roots · {shapes} shape hits · {installed} platforms installed · {withMemory} with memory · {notes} notes · {ms}ms',
  'doctor.dataRoot': 'data root {path}',
  'doctor.dataRootOverride': ' (AI_MEMORY_HOME override)',
  'doctor.clean': 'No findings.',
  'doctor.found': 'Found {total}',
  'doctor.byBlame': 'By blame: your data {userData} · descriptor {descriptor} · platform {platform}',
  'doctor.zeroWriteWarning': 'Warning: doctor modified the data directory, breaking the zero-write promise',

  // ---- platforms ----
  'platforms.summary': '{count} descriptors, {installed} matched on this machine',
  'platforms.summaryCustom': ', {n} of them custom',
  'platforms.customBadge': '[custom] ',
  'platforms.declared': '    declared: {roots}',
  'platforms.memory': '    memory: {scopes}',
  'platforms.local': '    present: {roots}  notes={notes}',
  'platforms.note': '    note: {note}',
  'platforms.choices': 'Available values:',

  // ---- skills: migration checklist ----
  'skills.migrateTitle': 'ai-memlint skills — migration checklist',
  'skills.target': 'Target  {label}  {rel}  currently {count} skills',
  'skills.source': 'Source  {label}  {rel}',
  'skills.counts': 'Count  missing {missing} · unchanged {same} · conflict {conflict} · total {total}',
  'skills.prepare': 'Prepare  $ {cmd}',
  'skills.state.missing': 'missing',
  'skills.state.conflict': 'conflict',
  'skills.state.same': 'unchanged',
  'skills.copies': ' ×{n} copies',
  'skills.from': '       from {rel}  {hash}  {size}',
  'skills.current': '       at target {rel}  {hash}',
  'skills.sourceOnlyTag': '  (source only)',

  // ---- skills: inventory ----
  'skills.inventorySummary': '{count} skills · {dirs} skill directories',
  'skills.targetsHeading': 'Migratable targets (--to):',
  'skills.sourceOnlyHeading': 'Source only (app-managed or workspace dirs, not install locations):',
  'skills.unit': '{n}',
  'skills.footer': 'Migration checklist: skills --to=<target> [--from=<source>]; this command only reads, it copies nothing.',

  // ---- verify ----
  'verify.sourceFiles': '{n} source files',
  'verify.pass': 'PASS',
  'verify.fail': 'FAIL',
  'verify.zeroDeps': 'zero dependencies   package.json={pkg} · node_modules={nm} · external imports={ext}',
  'verify.pkgWithDeps': 'present, {n} declared',
  'verify.pkgNone': 'absent',
  'verify.yes': 'yes',
  'verify.no': 'no',
  'verify.parseError': '      package.json cannot be parsed: {err}',
  'verify.zeroEgress': 'zero network egress  Node outbound APIs={node} · external origins={origins} · listen bindings={listens}{loopback}',
  'verify.loopback': ' (all loopback)',
  'verify.deleteCalls': 'delete calls        {n} — the tool never removes your files',
  'verify.writeCalls': '      write calls         {n}',
  'verify.integrity': 'source integrity    {files} files, sha256 {state} across two scans',
  'verify.identical': 'identical',
  'verify.changed': 'changed',
  'verify.zeroWrite': 'doctor zero-write   data directory {state}',
  'verify.unchanged': 'unchanged',
  'verify.notCreated': 'was not created',
  'verify.changedFiles': '  changed source files:',
  'verify.note': '  These are evidence lines for human review; verify does not replace an audit.',
  'verify.ev.nodeEgress': 'Node outbound APIs',
  'verify.ev.origins': 'external origins',
  'verify.ev.listens': 'listen bindings',
  'verify.ev.deletes': 'delete calls',
  'verify.ev.writes': 'write calls',

  // ---- findings: titles and fixes ----
  'finding.credential-plaintext.title': 'Plaintext credential in a memory file',
  'finding.credential-plaintext.fix': 'Rotate now: {marks}. The file is not copied into the data directory; the tool records only its path and rule names.',
  'finding.credential-sensitive.title': 'Sensitive identifiers in a memory file',
  'finding.credential-sensitive.fix': 'Matched {marks}. Masked when rendered; the source file is untouched.',
  'finding.orphan-note.title': 'Note is not referenced by the index, so retrieval can never load it',
  'finding.orphan-note.fix': 'Add {subject} to {index}, or the platform will never load this memory.',
  'finding.note-unreadable.title': 'Memory file cannot be read',
  'finding.note-unreadable.fix': 'Reading {subject} failed ({error}). The scan skips the file instead of aborting.',
  'finding.index-dangling-link.title': 'Index points at files that do not exist',
  'finding.index-dangling-link.fix': '{index} references {count} missing files: {items}.',
  'finding.conflict-cross-platform.title': 'Same memory key differs across platforms',
  'finding.conflict-cross-platform.fix': '{subject} differs between {owners}. The tool does not merge automatically; a human decides.',
  'finding.frontmatter-missing.title': 'Note has no frontmatter',
  'finding.frontmatter-missing.fix': '{count} notes have no frontmatter, so description cannot inform relevance: {items}.',
  'finding.descriptor-gap.title': 'Known platform has an uncovered memory directory',
  'finding.descriptor-gap.fix': '{subject} is attributed to {platform} but the descriptor does not declare it. Add it to lib/registry.mjs — PR welcome.',
  'finding.shape-unattributed.title': 'Memory-shaped directory, no descriptor',
  'finding.shape-unattributed.fix': '{subject} looks like memory but belongs to no known platform, so the tool does not parse it.',
  'finding.index-missing.title': 'Index declared by the descriptor does not exist',
  'finding.index-missing.fix': 'The descriptor says {platform} should have {index}, but that directory holds {count} notes and no index. The descriptor may be stale.',
  'finding.memory-empty.title': 'Memory directory exists but is empty',
  'finding.memory-empty.fix': '{subject} was created but holds no notes.',
  'finding.index-header-mismatch.title': 'Index header does not match the descriptor',
  'finding.index-header-mismatch.fix': 'The descriptor expects {expected} but found {actual}. Usually one vendor shipping two formats — fix the descriptor, not the data.',
  'finding.note-vanished.title': 'Note seen last scan, gone from every source now',
  'finding.note-vanished.fix': '{count} notes are no longer present in any source channel: {items}.',

  // ---- migrate ----
  'migrate.sensitive': 'Source contains sensitive content ({level}{rules}) — handle the credentials before copying',
  'migrate.sensitiveRules': ': {rules}',
  'migrate.noManifestName': 'Source SKILL.md has no frontmatter name; the target platform may not recognise it',
  'migrate.nameMismatch': 'Directory name {name} differs from frontmatter name {manifestName}',
  'migrate.nested': 'Directory also contains {n} nested skills, which would be copied too',
  'migrate.majority': '{copies} copies, {diff} of them different — the majority version was chosen',
  'migrate.conflict': 'Target already has this skill with different content ({current} vs {chosen}) — do not overwrite; compare first',
  'migrate.note': 'These commands are a checklist only; this tool never copies or moves anything. On Windows, run them in Git Bash.',
  'migrate.errTarget': 'Unknown migration target: {key}',
  'migrate.errSource': 'Unknown source: {key}',
  'migrate.errSame': 'Source and target are the same directory',

  // ---- custom platforms ----
  'custom.errArray': 'platforms must be an array',
  'custom.errMax': 'at most {n} custom platforms',
  'custom.errLabel': 'name must be 1-60 characters',
  'custom.errRoots': '{label}: needs 1-{max} root directories',
  'custom.errAbsolute': '{label}: root must be absolute or start with ~ (got {root})',
  'custom.errDotDotRoot': '{label}: root may not contain a .. segment',
  'custom.errDotDotMemory': '{label}: memory subdirectory may not contain a .. segment',
  'custom.errIndex': '{label}: index must be a file name, without a path',
};
