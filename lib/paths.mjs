// Code root vs data root.
//
// CODE_ROOT locates program assets (lib/, web/, bin/) and is never written to.
// DATA_ROOT holds derived artifacts and follows platform convention.
//
// Windows uses Local, never Roaming: a Roaming profile syncs to a domain server, and
// the store holds note bodies that were classified 'sensitive'. Sending those off-box
// would be a secret-exfil path created by a one-line convenience. registry.mjs exports
// a Roaming-based AD() for locating *other vendors'* data — do not reuse it here.
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HOME = homedir();
export const CODE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function dataBase() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local');
  }
  if (process.platform === 'darwin') return join(HOME, 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME || join(HOME, '.local', 'share');
}

export const DATA_ROOT = process.env.AI_MEMORY_HOME || join(dataBase(), 'ai-memory');

export const STORE = join(DATA_ROOT, 'store');
export const STATE_PATH = join(DATA_ROOT, 'state.json');
export const REPORT_PATH = join(DATA_ROOT, 'report.json');
export const SKILLS_REPORT_PATH = join(DATA_ROOT, 'skills.json');
export const WEB_ROOT = join(CODE_ROOT, 'web');
export const BIN = join(CODE_ROOT, 'bin');

// Legacy location, from before code and data roots were separated. Read only, to carry
// run history forward; never written.
export const LEGACY_ROOT = join(HOME, '.ai-memory');

export function resolve() {
  return {
    code: CODE_ROOT,
    data: DATA_ROOT,
    store: STORE,
    overridden: !!process.env.AI_MEMORY_HOME,
    base: dataBase(),
  };
}

// Absolute paths carry the OS username. Anything meant to be pasted into an issue goes
// through this first.
export function displayPath(p) {
  if (typeof p !== 'string') return p;
  if (p === HOME) return '~';
  if (p.startsWith(HOME + '/') || p.startsWith(HOME + '\\')) return '~' + p.slice(HOME.length);
  return p;
}
