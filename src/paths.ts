import * as os from 'os';
import * as path from 'path';

function appSupportDir(appFolderName: string): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appFolderName);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), appFolderName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), appFolderName);
}

export function cursorGlobalStateDb(): string {
  return path.join(appSupportDir('Cursor'), 'User', 'globalStorage', 'state.vscdb');
}

export function traeStorageJson(): string {
  return path.join(appSupportDir('Trae'), 'User', 'globalStorage', 'storage.json');
}

export function antigravityGlobalStateDb(): string {
  return path.join(appSupportDir('Antigravity'), 'User', 'globalStorage', 'state.vscdb');
}

export function workspaceStateDb(appFolderName: string, workspaceDir: string, ctimeMs: number): string {
  const crypto = require('crypto') as typeof import('crypto');
  const normalized =
    process.platform === 'win32'
      ? workspaceDir.replace(/^([A-Z]):/, (_m, letter: string) => letter.toLowerCase() + ':')
      : workspaceDir;
  const workspaceId = crypto.createHash('md5').update(normalized + Math.floor(ctimeMs).toString(), 'utf8').digest('hex');
  return path.join(appSupportDir(appFolderName), 'User', 'workspaceStorage', workspaceId, 'state.vscdb');
}
