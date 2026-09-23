import { execFile } from 'child_process';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { promisify } from 'util';
import * as vscode from 'vscode';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { log } from './log';

const execFileAsync = promisify(execFile);
const SQLJS_MAX_BYTES = 80 * 1024 * 1024;
const VALUE_MAX_CHARS = 16_384;
const QUERY_TIMEOUT_MS = 3000;
const QUERY_CACHE_TTL_MS = 15 * 60 * 1000;

let sqlPromise: Promise<SqlJsStatic> | undefined;
const commandCache = new Map<string, boolean>();
const queryCache = new Map<string, { expiresAt: number; value: string | null }>();

export function wasmPath(context: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(context.extensionUri, 'dist', 'sql-wasm.wasm').fsPath;
}

async function sqlJs(context: vscode.ExtensionContext): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs({ locateFile: () => wasmPath(context) });
  }
  return sqlPromise;
}

async function hasCommand(cmd: string): Promise<boolean> {
  const cached = commandCache.get(cmd);
  if (cached !== undefined) return cached;
  try {
    await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 1000 });
    commandCache.set(cmd, true);
    return true;
  } catch {
    commandCache.set(cmd, false);
    return false;
  }
}

function selectSql(key: string): string {
  const escaped = key.replace(/'/g, "''");
  return `SELECT CASE WHEN length(value) <= ${VALUE_MAX_CHARS} THEN value ELSE NULL END FROM ItemTable WHERE key='${escaped}' LIMIT 1;`;
}

async function queryWithSqliteCli(dbPath: string, key: string): Promise<string | null> {
  if (!(await hasCommand('sqlite3'))) return null;
  const uri = `file:${dbPath}?mode=ro&immutable=1`;
  const { stdout } = await execFileAsync('sqlite3', [uri, selectSql(key)], {
    timeout: QUERY_TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: VALUE_MAX_CHARS * 2
  });
  const token = stdout.trim().replace(/^"|"$/g, '');
  return token || null;
}

async function queryWithPython(dbPath: string, key: string): Promise<string | null> {
  if (!(await hasCommand('python3'))) return null;
  const script = `
import sqlite3, sys
con = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro&immutable=1", uri=True)
row = con.execute("SELECT value FROM ItemTable WHERE key=? AND length(value)<=?", (sys.argv[2], int(sys.argv[3]))).fetchone()
sys.stdout.write(row[0] if row and row[0] is not None else "")
`.trim();
  const { stdout } = await execFileAsync('python3', ['-c', script, dbPath, key, String(VALUE_MAX_CHARS)], {
    timeout: QUERY_TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: VALUE_MAX_CHARS * 2
  });
  return stdout.trim() || null;
}

async function queryWithSqlJs(context: vscode.ExtensionContext, dbPath: string, key: string): Promise<string | null> {
  const size = fs.statSync(dbPath).size;
  if (size > SQLJS_MAX_BYTES) {
    throw new Error(`banco grande demais para sql.js (${Math.round(size / 1024 / 1024)} MB)`);
  }
  let db: Database | undefined;
  try {
    const SQL = await sqlJs(context);
    const fileBuffer = await fsp.readFile(dbPath);
    db = new SQL.Database(fileBuffer);
    const res = db.exec(selectSql(key));
    if (!res.length || !res[0].values.length) return null;
    const val = res[0].values[0][0];
    return typeof val === 'string' ? val : val == null ? null : String(val);
  } finally {
    db?.close();
  }
}

export async function queryItemTable(context: vscode.ExtensionContext, dbPath: string, key: string): Promise<string | null> {
  const cacheKey = `${dbPath}\0${key}`;
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  let value: string | null = null;
  try {
    value = await queryWithSqliteCli(dbPath, key);
  } catch (error) {
    log(`sqlite3 CLI falhou (${key}): ${error}`);
  }
  if (!value) {
    try {
      value = await queryWithPython(dbPath, key);
    } catch (error) {
      log(`python sqlite falhou (${key}): ${error}`);
    }
  }
  if (!value) {
    try {
      value = await queryWithSqlJs(context, dbPath, key);
    } catch (error) {
      log(`sql.js falhou (${key}): ${error}`);
    }
  }
  queryCache.set(cacheKey, {
    expiresAt: Date.now() + (value ? QUERY_CACHE_TTL_MS : 30_000),
    value
  });
  return value;
}
