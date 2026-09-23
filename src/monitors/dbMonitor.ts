import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as vscode from 'vscode';
import { getAppType } from '../config';
import { log } from '../log';
import { workspaceStateDb } from '../paths';

const DEBOUNCE_MS = 1500;
const BACKUP_MS = 60_000;

export class DbMonitor {
  private watchers: fs.FSWatcher[] = [];
  private debounce: ReturnType<typeof setTimeout> | undefined;
  private backup: ReturnType<typeof setInterval> | undefined;
  private lastStamp = '';
  private dbPath: string | null = null;

  constructor(
    private readonly onRefresh: () => void,
    private readonly onComposerChange?: (lastUpdateMs: number) => void
  ) {}

  async start(): Promise<void> {
    await this.tick();
    this.backup = setInterval(() => void this.tick(), BACKUP_MS);
  }

  stop(): void {
    this.cleanupWatchers();
    if (this.backup) clearInterval(this.backup);
    if (this.debounce) clearTimeout(this.debounce);
  }

  private cleanupWatchers(): void {
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {
        /* ignore */
      }
    }
    this.watchers = [];
  }

  private async resolveDbPath(): Promise<string | null> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return null;
    try {
      const dir = folders[0].uri.fsPath;
      const stats = await fsp.stat(dir);
      const ctime = (stats as { birthtimeMs?: number; ctimeMs: number }).birthtimeMs || stats.ctimeMs;
      const app = getAppType() === 'trae' ? 'Trae' : vscode.env.appName || 'Cursor';
      const candidate = workspaceStateDb(app, dir, ctime);
      return fs.existsSync(candidate) ? candidate : null;
    } catch {
      return null;
    }
  }

  private watch(dbPath: string): void {
    this.cleanupWatchers();
    this.dbPath = dbPath;
    const watch = (file: string) => {
      try {
        const w = fs.watch(file, () => this.schedule());
        w.on('error', () => this.schedule());
        this.watchers.push(w);
      } catch {
        /* ignore */
      }
    };
    watch(dbPath);
    const wal = `${dbPath}-wal`;
    if (fs.existsSync(wal)) watch(wal);
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.tick(), DEBOUNCE_MS);
  }

  private async tick(): Promise<void> {
    try {
      const dbPath = await this.resolveDbPath();
      if (!dbPath) return;
      if (dbPath !== this.dbPath) this.watch(dbPath);
      const wal = `${dbPath}-wal`;
      const stat = fs.existsSync(wal) ? await fsp.stat(wal) : await fsp.stat(dbPath);
      const stamp = `${dbPath}:${stat.mtimeMs}:${stat.size}`;
      if (stamp === this.lastStamp) return;
      this.lastStamp = stamp;
      this.onRefresh();
      this.onComposerChange?.(stat.mtimeMs);
    } catch (error) {
      log(`DbMonitor: ${error}`);
    }
  }
}
