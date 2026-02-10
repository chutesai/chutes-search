const assert = require('node:assert');
const { describe, it } = require('node:test');

const b64 = require('./base64url.ts');
const pkce = require('./pkce.ts');
const seal = require('./seal.ts');
const req = require('./request.ts');
const idp = require('./chutesIdp.ts');

describe('base64url', () => {
  it('roundtrips bytes', () => {
    const buf = Buffer.from('hello world');
    const enc = b64.base64UrlEncode(buf);
    const dec = b64.base64UrlDecode(enc);
    assert.equal(dec.toString('utf8'), 'hello world');
  });
});

describe('pkce', () => {
  it('generates verifier and challenge', () => {
    const { codeVerifier, codeChallenge } = pkce.generatePkcePair();
    assert.ok(typeof codeVerifier === 'string' && codeVerifier.length >= 43);
    assert.ok(typeof codeChallenge === 'string' && codeChallenge.length > 10);
    assert.notEqual(codeVerifier, codeChallenge);
  });

  it('generates urlsafe state', () => {
    const state = pkce.generateOAuthState();
    assert.ok(/^[A-Za-z0-9_-]+$/.test(state));
  });
});

describe('seal', () => {
  it('seals and unseals json', () => {
    const token = seal.sealJson({ a: 1, b: 'x' }, 'secret');
    const parsed = seal.unsealJson(token, 'secret');
    assert.deepEqual(parsed, { a: 1, b: 'x' });
  });

  it('fails with wrong secret', () => {
    const token = seal.sealJson({ a: 1 }, 'secret');
    assert.throws(() => seal.unsealJson(token, 'wrong'), /Unsupported state|unable to authenticate data|bad decrypt|Invalid/);
  });

  it('seals and unseals string', () => {
    const token = seal.sealString('abc', 'secret');
    const value = seal.unsealString(token, 'secret');
    assert.equal(value, 'abc');
  });
});

describe('request helpers', () => {
  it('accepts only safe returnTo', () => {
    assert.equal(req.getSafeReturnTo('/settings'), '/settings');
    assert.equal(req.getSafeReturnTo('https://evil.com'), '/');
    assert.equal(req.getSafeReturnTo('//evil.com'), '/');
    assert.equal(req.getSafeReturnTo(null), '/');
  });
});

describe('authorization url', () => {
  it('includes required params', () => {
    const url = idp.buildChutesAuthorizationUrl({
      clientId: 'cid_test',
      redirectUri: 'http://localhost/callback',
      scopes: 'openid profile',
      state: 'state123',
      codeChallenge: 'challenge',
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('client_id'), 'cid_test');
    assert.equal(parsed.searchParams.get('redirect_uri'), 'http://localhost/callback');
    assert.equal(parsed.searchParams.get('scope'), 'openid profile');
    assert.equal(parsed.searchParams.get('state'), 'state123');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
  });
});

