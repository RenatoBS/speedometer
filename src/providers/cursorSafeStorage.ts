import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { cursorUserDataDir } from '../paths';

const execFileAsync = promisify(execFile);

export const CURSOR_SAFE_STORAGE_PREFIX = 'cursor-safe-storage:v1:';

const KEYCHAIN_TIMEOUT_MS = 45_000;
const SALT = 'saltysalt';
const PBKDF2_ITERATIONS = 1003;

let osPasswordPromise: Promise<string> | null = null;
let windowsKeyPromise: Promise<Buffer> | null = null;

export function isEncryptedCursorToken(value: string): boolean {
  return value.startsWith(CURSOR_SAFE_STORAGE_PREFIX);
}

export function decodeCursorSafeStorage(stored: string): Buffer {
  if (!isEncryptedCursorToken(stored)) {
    throw new Error('prefixo cursor-safe-storage ausente');
  }
  const payload = Buffer.from(stored.slice(CURSOR_SAFE_STORAGE_PREFIX.length), 'base64');
  if (payload.length < 4) throw new Error('payload do safe storage vazio');
  return payload;
}

// Chromium OSCrypt no macOS/Linux: "v10" + AES-128-CBC, chave PBKDF2-SHA1 e IV de espaços.
export function openV10Cbc(payload: Buffer, password: string): string {
  const version = payload.subarray(0, 3).toString('utf8');
  if (version !== 'v10') throw new Error(`versão de criptografia ${version} não suportada`);
  const key = crypto.pbkdf2Sync(password, SALT, PBKDF2_ITERATIONS, 16, 'sha1');
  const iv = Buffer.alloc(16, ' ');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  return Buffer.concat([decipher.update(payload.subarray(3)), decipher.final()]).toString('utf8');
}

// Chromium OSCrypt no Windows: "v10" + nonce(12) + ciphertext + tag(16), AES-256-GCM.
export function openV10Gcm(payload: Buffer, key: Buffer): string {
  const version = payload.subarray(0, 3).toString('utf8');
  if (version !== 'v10') throw new Error(`versão de criptografia ${version} não suportada`);
  const body = payload.subarray(3);
  if (key.length !== 32) throw new Error(`chave OSCrypt com ${key.length} bytes`);
  if (body.length < 12 + 16 + 1) throw new Error('blob v10 curto');
  const nonce = body.subarray(0, 12);
  const tag = body.subarray(body.length - 16);
  const data = body.subarray(12, body.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function chomp(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1).replace(/\r$/, '') : value;
}

function isKeychainMiss(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not be found|item not found|The specified item could not be found/i.test(message);
}

async function readSecurityPassword(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('security', ['find-generic-password', '-w', ...args], {
    timeout: KEYCHAIN_TIMEOUT_MS,
    encoding: 'utf8',
    maxBuffer: 64 * 1024
  });
  const password = chomp(stdout);
  if (!password) throw new Error('senha do chaveiro vazia');
  return password;
}

async function readMacKeychainPassword(): Promise<string> {
  const attempts: string[][] = [
    ['-s', 'Cursor Safe Storage', '-a', 'Cursor'],
    ['-s', 'Cursor Safe Storage'],
    ['-s', 'Chromium Safe Storage', '-a', 'Chromium']
  ];
  let lastMiss = 'item Cursor Safe Storage não encontrado no chaveiro';
  for (const args of attempts) {
    try {
      return await readSecurityPassword(args);
    } catch (error) {
      if (!isKeychainMiss(error)) throw error;
      lastMiss = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastMiss);
}

async function readLinuxPassword(): Promise<string> {
  for (const application of ['Cursor', 'cursor', 'chrome', 'Chromium']) {
    try {
      const { stdout } = await execFileAsync('secret-tool', ['lookup', 'application', application], {
        timeout: KEYCHAIN_TIMEOUT_MS,
        encoding: 'utf8',
        maxBuffer: 64 * 1024
      });
      const password = chomp(stdout);
      if (password) return password;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
      if (code === 'ENOENT') break;
    }
  }
  return 'peanuts';
}

function osPassword(): Promise<string> {
  if (!osPasswordPromise) {
    const load = process.platform === 'darwin' ? readMacKeychainPassword() : readLinuxPassword();
    osPasswordPromise = load.catch((error) => {
      osPasswordPromise = null;
      throw error;
    });
  }
  return osPasswordPromise;
}

async function unprotectDpapi(blob: Buffer): Promise<Buffer> {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${blob.toString('base64')}')
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`.trim();
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: KEYCHAIN_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 1024 * 1024 }
  );
  const key = Buffer.from(chomp(stdout).trim(), 'base64');
  if (key.length === 0) throw new Error('DPAPI devolveu chave vazia');
  return key;
}

async function readWindowsOsCryptKey(): Promise<Buffer> {
  const localStatePath = path.join(cursorUserDataDir(), 'Local State');
  const raw = await fs.readFile(localStatePath, 'utf8');
  const parsed = JSON.parse(raw) as { os_crypt?: { encrypted_key?: unknown } };
  const encryptedKeyB64 = parsed.os_crypt?.encrypted_key;
  if (typeof encryptedKeyB64 !== 'string' || !encryptedKeyB64) {
    throw new Error('Local State sem os_crypt.encrypted_key');
  }
  const encryptedKey = Buffer.from(encryptedKeyB64, 'base64');
  const dpapiPrefix = Buffer.from('DPAPI');
  if (encryptedKey.length <= dpapiPrefix.length || !encryptedKey.subarray(0, dpapiPrefix.length).equals(dpapiPrefix)) {
    throw new Error('chave OSCrypt sem prefixo DPAPI');
  }
  return unprotectDpapi(encryptedKey.subarray(dpapiPrefix.length));
}

function windowsKey(): Promise<Buffer> {
  if (!windowsKeyPromise) {
    windowsKeyPromise = readWindowsOsCryptKey().catch((error) => {
      windowsKeyPromise = null;
      throw error;
    });
  }
  return windowsKeyPromise;
}

export async function openCursorAccessToken(stored: string): Promise<string> {
  if (!isEncryptedCursorToken(stored)) return stored;
  const payload = decodeCursorSafeStorage(stored);
  if (process.platform === 'win32') return openV10Gcm(payload, await windowsKey());
  return openV10Cbc(payload, await osPassword());
}
