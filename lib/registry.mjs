// Platform descriptor registry. Add an entry here to teach the probe a new platform.
//
// roots         where memory actually lives (relative to home, or appData())
// installMarkers  paths whose existence proves the platform is installed
// memory        scope -> { dir, notes, index } ; {key} in dir = dynamic segment
// parse         slugFrom: 'filename' | 'frontmatter'   (NEVER default to frontmatter:
//               .qoder uses name=slug, .qoder-cn uses name=human title — measured)
//               indexHeader: does MEMORY.md start with '# Memory index'
//               monolith: single UID-keyed profile doc, rewritten wholesale
// skillsInstall dir under a root holding user-installed skills. Only set where measured;
//               omitted when the root has app-managed dirs only (trae: builtin_skills).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const H = (...p) => join(HOME, ...p);
const AD = (...p) => {
  const base =
    process.platform === 'win32' ? join(HOME, 'AppData', 'Roaming')
    : process.platform === 'darwin' ? join(HOME, 'Library', 'Application Support')
    : join(HOME, '.config');
  return join(base, ...p);
};

const noteScope = (dir, index = 'MEMORY.md') => ({ dir, notes: '*.md', index });

export const PLATFORMS = [
  {
    id: 'qoder', label: 'Qoder', family: 'qoder',
    roots: [H('.qoder')], installMarkers: [AD('Qoder'), AD('com.qoder.app.stable')], skillsInstall: 'skills',
    memory: { user: noteScope('memory'), project: noteScope('projects/{key}/memory') },
    parse: { slugFrom: 'filename', frontmatter: true, indexHeader: true },
  },
  {
    id: 'qoder-cn', label: 'Qoder CN', family: 'qoder',
    roots: [H('.qoder-cn')], installMarkers: [AD('com.qodercn.app.stable')], skillsInstall: 'skills',
    memory: { user: noteScope('memory'), project: noteScope('projects/{key}/memory') },
    parse: { slugFrom: 'filename', frontmatter: true, indexHeader: false },
  },
  {
    id: 'codebuddy', label: 'CodeBuddy', family: 'tencent',
    roots: [H('.codebuddy'), H('.codebuddycn')], installMarkers: [AD('CodeBuddy CN')], skillsInstall: 'skills',
    memory: { user: { dir: 'memery', notes: '*_memery.md', index: null } },
    parse: { slugFrom: 'filename', frontmatter: false, monolith: true },
    quirks: { ignore: ['*.bak'], note: '目录名拼作 memery，不是 memory' },
  },
  {
    id: 'workbuddy', label: 'WorkBuddy', family: 'tencent',
    roots: [H('.workbuddy')], installMarkers: [H('.workbuddy-key-fallback'), H('.ai-hive', 'workbuddy')], skillsInstall: 'skills',
    memory: { user: { dir: 'memory', notes: '*_memory.md', index: null } },
    parse: { slugFrom: 'filename', frontmatter: false, monolith: true },
    quirks: { ignore: ['*.bak'], note: '与 CodeBuddy 同 UID 血缘；app/memory 为空的次级存储' },
  },
  {
    id: 'trae', label: 'Trae', family: 'bytedance',
    roots: [H('.trae-cn'), H('.trae-aicc'), H('.trae')], installMarkers: [AD('Trae CN'), AD('Trae')],
    memory: null,
    rules: { dirs: ['.trae/rules'], files: ['AGENTS.md'] },
    parse: { note: '未发现文件型记忆，状态可能存于 AppData SQLite' },
  },
  {
    id: 'claude', label: 'Claude Code', family: 'anthropic',
    roots: [H('.claude')], installMarkers: [H('.claude.json')],
    memory: { user: noteScope('memory', null) },
    rules: { files: ['CLAUDE.md'] },
    parse: { slugFrom: 'filename', frontmatter: true },
  },
  {
    id: 'codex', label: 'Codex CLI', family: 'openai',
    roots: [H('.codex')], installMarkers: [H('.codex', 'config.toml')],
    memory: null, rules: { files: ['AGENTS.md'] },
    parse: {},
  },
  {
    id: 'cursor', label: 'Cursor', family: 'cursor',
    roots: [H('.cursor')], installMarkers: [AD('Cursor')],
    memory: null, rules: { dirs: ['rules'], globs: ['*.mdc'] },
    parse: {},
  },
  {
    id: 'windsurf', label: 'Windsurf', family: 'codeium',
    roots: [H('.windsurf'), H('.codeium')], installMarkers: [AD('Windsurf')],
    memory: null, rules: { files: ['.windsurfrules'], dirs: ['rules'] },
    parse: {},
  },
  {
    id: 'gemini', label: 'Gemini CLI', family: 'google',
    roots: [H('.gemini')], installMarkers: [H('.gemini', 'settings.json')],
    memory: null, rules: { files: ['GEMINI.md'] },
    parse: {},
  },
  {
    id: 'cline', label: 'Cline', family: 'vscode-ext',
    roots: [H('.cline')], installMarkers: [],
    memory: { user: noteScope('memory', null) }, rules: { files: ['.clinerules'] },
    parse: { slugFrom: 'filename' },
  },
  {
    id: 'roo', label: 'Roo Code', family: 'vscode-ext',
    roots: [H('.roo')], installMarkers: [], memory: null, rules: { dirs: ['rules'] }, parse: {},
  },
  {
    id: 'lingma', label: '通义灵码', family: 'alibaba',
    roots: [H('.lingma')], installMarkers: [], memory: null, rules: { dirs: ['rules'] }, parse: {},
  },
  {
    id: 'comate', label: '文心快码', family: 'baidu',
    roots: [H('.comate')], installMarkers: [], memory: null, rules: { dirs: ['rules'] }, parse: {},
  },
  {
    id: 'continue', label: 'Continue', family: 'vscode-ext',
    roots: [H('.continue')], installMarkers: [], memory: null, rules: { files: ['.continuerules'] }, parse: {},
  },
  {
    id: 'openclaw', label: 'OpenClaw', family: 'openclaw',
    roots: [H('.openclaw')], installMarkers: [H('.openclaw', 'identity')], skillsInstall: 'skills',
    memory: null,
    parse: { note: 'skills/memory 与 agents/*/workspace/memory 是技能目录，非平台记忆，已排除' },
    quirks: { ignoreDirs: ['skills', 'agents', 'workspace'] },
  },
  {
    id: 'zcode', label: 'ZCode', family: 'unknown',
    roots: [H('.zcode')], installMarkers: [AD('ZCode')], memory: null, parse: {},
  },
];

export const anyRoot = (p) => p.roots.some((r) => existsSync(r));
export const anyMarker = (p) => (p.installMarkers ?? []).some((m) => existsSync(m));
export { HOME, H, AD };
