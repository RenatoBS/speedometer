const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { constructSessionToken } = require('../out/providers/cursorApi');
const { decodeCursorSafeStorage, isEncryptedCursorToken, openV10Cbc, openV10Gcm } = require('../out/providers/cursorSafeStorage');

test('monta WorkosCursorSessionToken a partir do JWT (sub com |)', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'auth0|user_abc' })).toString('base64url');
  const token = `hdr.${payload}.sig`;
  assert.equal(constructSessionToken(token), `user_abc%3A%3A${token}`);
});

test('usa o sub inteiro quando não há pipe', () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'user_abc' })).toString('base64url');
  const token = `hdr.${payload}.sig`;
  assert.equal(constructSessionToken(token), `user_abc%3A%3A${token}`);
});

test('retorna null para token inválido', () => {
  assert.equal(constructSessionToken('not-a-jwt'), null);
  assert.equal(constructSessionToken('cursor-safe-storage:v1:aaaa'), null);
});

test('abre o blob v10 do safe storage (AES-128-CBC do macOS)', () => {
  const stored = `cursor-safe-storage:v1:djEwxFNnv7Wz2z/KVO8Cq7d31A==`;
  assert.equal(isEncryptedCursorToken(stored), true);
  assert.equal(openV10Cbc(decodeCursorSafeStorage(stored), 'cursor-test-password'), 'hdr.payload.sig');
});

test('abre o blob v10 do Windows (AES-256-GCM)', () => {
  const key = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const plain = 'hdr.payload.sig';
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const payload = Buffer.concat([Buffer.from('v10'), nonce, data, cipher.getAuthTag()]);
  assert.equal(openV10Gcm(payload, key), plain);
});
