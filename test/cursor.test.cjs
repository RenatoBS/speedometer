const assert = require('node:assert/strict');
const test = require('node:test');
const { constructSessionToken } = require('../out/providers/cursorApi');

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
});
