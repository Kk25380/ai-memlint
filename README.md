# ai-memlint

Read-only, zero-dependency auditor for AI coding agents' memory files.
Local-only by design: no network egress, no telemetry, no writes to any platform's memory directory.

Coding agents accumulate memory files across platforms (Qoder, Claude, CodeBuddy, WorkBuddy, …).
Those files drift: secrets get pasted into them, notes fall out of the index that loads them,
descriptors point at directories that no longer exist. ai-memlint probes every installed
platform's memory roots and reports what it finds, with file and line coordinates.

## What it reports

- **Plaintext credentials** in memory notes (rule + line, value never copied anywhere).
- **Sensitive identifiers** (app ids, env ids, key paths, …) with per-line marks.
- **Orphaned notes** the platform's index never references, so retrieval can never load them.
- **Descriptor gaps**: shape-matched memory directories no registry entry covers.

Findings carry severity (how urgent) and blame (who acts: your data / this tool's descriptors /
the platform). Renderers: CLI, a loopback web viewer, and JSON.

## Skills

The same roots hold skills, which drift differently: a skill installed for one agent is invisible
to the next one, and the copies diverge. `skills` walks every root for `SKILL.md`, parses its
frontmatter, attributes each hit to a platform, and can turn the inventory into a migration
checklist for one target directory.

```sh
node bin/cli.mjs skills                        # inventory: every skill, grouped by platform
node bin/cli.mjs skills --to=qoder             # checklist for installing into qoder's skills dir
node bin/cli.mjs skills --to=qoder --from=.hub/skills   # restrict the source
```

The checklist names the state of each skill at the target — missing, same content, or conflicting
— picks the majority version when several copies exist, and prints the `cp -r` commands to run.
It never runs them, never moves or deletes anything, and refuses targets that are app-managed
(a `builtin_skills` directory is not yours to install into). A conflicting skill prints a warning
instead of a command. The viewer's 技能 tab renders the same report with copy buttons.

The skill walk is opt-in on both surfaces because it stats every directory under every root:
it roughly doubles probe time, so `doctor` and `verify` skip it.

## Quickstart

Node 18+. No dependencies, no build step.

```sh
node bin/cli.mjs doctor          # scan + findings; writes nothing
node bin/cli.mjs view            # loopback web viewer (findings first)
node bin/cli.mjs verify          # measured trust assertions, with evidence lines
node bin/cli.mjs platforms       # what the registry looks for, what matched here
node bin/cli.mjs skills          # skill inventory + migration checklist (opt-in probe)
node bin/cli.mjs harvest         # opt-in: materialize a readable store
npm test                         # unit suite (node:test; no dependencies, no fixtures on disk)
```

`package.json` declares a `bin` and nothing else, so a clone can also be installed as a command:

```sh
npm install -g .                 # then: ai-memlint doctor
```

Data root: `%LOCALAPPDATA%\ai-memory` on Windows, `~/Library/Application Support/ai-memory` on
macOS, `$XDG_DATA_HOME/ai-memory` (default `~/.local/share/ai-memory`) on Linux; override with
`AI_MEMORY_HOME`. CLI and viewer prose is currently zh-CN.

Platforms the built-in registry does not know can be added from the viewer's 平台 tab (or by
editing `platforms.json` in the data root). Custom entries are pure data — paths and file
names, no regex or code — and their notes go through the same credential and line-mark checks.

## Languages

CLI output is available in English and Chinese: `--lang=<en|zh>`, or `AI_MEMLINT_LANG`, or
the OS locale as the default.

```sh
node bin/cli.mjs doctor --lang=en
AI_MEMLINT_LANG=zh node bin/cli.mjs verify
```

Messages live in `lib/locales/`, one module per language, with English as the base. A missing
key falls back to English instead of rendering a raw identifier, and `test/i18n.test.mjs`
fails when a locale's key set or placeholder names drift from the base — so a half-finished
translation cannot ship silently.

The JSON report is locale-independent: it carries finding ids and data, never prose. The web
viewer's chrome is still Chinese; its report content follows the same locale as the CLI.

## Security model

- The audit path writes nothing. Every viewer GET re-probes live, `/api/skills` included;
  the two mutating endpoints are `POST /api/harvest` (opt-in store materialization) and
  `POST /api/custom` (custom platform descriptors), both confined to the data root.
- Skill migration is a report, not an action: `/api/skills` and `cli.mjs skills` enumerate
  directories and read manifests, then print a checklist. Neither can copy, move or delete
  a skill — `verify`'s zero-delete assertion covers them.
- Plaintext-credential note bodies are never copied into the data directory. Such notes
  expose path, rules and line marks only; a per-browser opt-in can render a masked live
  read of the source, remembered in that browser's localStorage, never on the server.
- Sensitive notes are stored masked; masking preserves line structure, so line numbers
  stay valid between source and store copy.
- The viewer binds loopback only, validates Host against DNS rebinding, gates every request
  with a per-launch token, sends no CORS headers, and marks responses `no-store`.
- Absolute paths carry the OS username. `/api/skills` and the `skills` inventory render paths
  home-relative, and their copy commands `$HOME`-relative POSIX, which still expands inside Git
  Bash double quotes. The CLI's report-mode commands are the exception: native and absolute, so
  they paste straight into a shell. `--redact-paths` rewrites the username out of any output you
  are about to share — including project-key slugs, which embed it without being paths.
  Known gap: the viewer's other payloads still show those slugs unredacted.
- `verify` prints assertions as measurements, not promises: no declared dependencies (a
  `package.json` may exist — it carries the `bin` entry — but every dependency field must be
  empty, `node_modules` absent, and an unparseable manifest fails rather than passing silently),
  zero Node-side egress, zero delete calls, an inventory of every write call, source-file
  integrity across two probe passes, and doctor's zero-write check against a data-root snapshot.

## Layout

```
bin/    cli.mjs · harvest.mjs · serve.mjs
lib/    probe.mjs · registry.mjs · findings.mjs · skills.mjs · migrate.mjs
        custom.mjs · redact.mjs · paths.mjs · verify.mjs · i18n.mjs
        locales/  en.mjs · zh.mjs (one module per language; English is the base)
web/    index.html (single-file viewer, no build step)
test/   *.test.mjs (node:test; pure fixtures, nothing touches the filesystem)
```

`probe.mjs` collects facts (roots, shape hits, memory stores, skill manifests); `findings.mjs`
turns them into reportable findings; `migrate.mjs` turns the skill inventory into a copy
checklist. All three only read.

## Non-goals

No write-back or auto-reference into any platform's memory directory; the store is opt-in
and separate. No skill is ever moved, copied or deleted — migration output is a checklist
for you to run yourself. No cloud sync, no hosted service: this tool audits sensitive local
data and is meant to be cloned and run on your own machine.

## Roadmap

Parked, not dropped: actually *performing* a skill migration. Executing copies means writing
into platform directories, which would break this tool's central promise, so it belongs in a
sibling project (working name `ai-skillport`) carrying its own trust surface — dry-run by
default, per-skill confirmation, a reversible plan. ai-memlint would keep producing the
checklist such a tool consumes.

## License

MIT — see [LICENSE](LICENSE).
