const assert = require('node:assert');
const { describe, it, beforeEach, afterEach } = require('node:test');

// cookieSession transitively imports the DB module; provide a dummy URL
// so the import succeeds without a real database.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
}

const b64 = require('./base64url.ts');
const pkce = require('./pkce.ts');
const seal = require('./seal.ts');
const req = require('./request.ts');
const idp = require('./chutesIdp.ts');
const cookieSession = require('./cookieSession.ts');

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

describe('cookieSession', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CHUTES_AUTH_SECRET;
    process.env.CHUTES_AUTH_SECRET = 'test-secret-for-unit-tests';
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.CHUTES_AUTH_SECRET = origEnv;
    else delete process.env.CHUTES_AUTH_SECRET;
  });

  it('getSessionCookieOpts returns correct structure', () => {
    const opts = cookieSession.getSessionCookieOpts();
    assert.equal(opts.path, '/');
    assert.equal(opts.httpOnly, true);
    assert.equal(opts.sameSite, 'lax');
    assert.equal(opts.maxAge, 30 * 24 * 60 * 60);
    assert.ok(opts.expires instanceof Date);
    const expectedExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const diff = Math.abs(opts.expires.getTime() - expectedExpiry);
    assert.ok(diff < 2000, `expires should be ~30 days from now, diff=${diff}ms`);
  });

  it('getSessionCookieOpts returns fresh expires on each call', () => {
    const a = cookieSession.getSessionCookieOpts();
    const b = cookieSession.getSessionCookieOpts();
    assert.ok(b.expires.getTime() >= a.expires.getTime());
  });

  it('sealSessionToCookie produces cc5_ prefixed value', () => {
    const session = {
      sessionId: 'sid-123',
      user: { id: 'uid-456', username: 'testuser' },
      accessToken: 'at-789',
      refreshToken: 'rt-abc',
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      scope: 'openid profile',
      tokenType: 'Bearer',
    };
    const sealed = cookieSession.sealSessionToCookie(session);
    assert.ok(sealed.startsWith('cc5_'), `Expected cc5_ prefix, got: ${sealed.slice(0, 10)}`);
  });

  it('unsealSessionFromCookie roundtrips a session', () => {
    const session = {
      sessionId: 'sid-roundtrip',
      user: { id: 'uid-rt', username: 'roundtripuser' },
      accessToken: 'access-token-value',
      refreshToken: 'refresh-token-value',
      accessTokenExpiresAt: 1700000000,
      scope: 'openid',
      tokenType: 'Bearer',
    };
    const sealed = cookieSession.sealSessionToCookie(session);
    const unsealed = cookieSession.unsealSessionFromCookie(sealed);
    assert.deepEqual(unsealed, session);
  });

  it('unsealSessionFromCookie returns null for non-cc5 values', () => {
    assert.equal(cookieSession.unsealSessionFromCookie('plain-session-id'), null);
  });

  it('unsealSessionFromCookie returns null for corrupted data', () => {
    assert.equal(cookieSession.unsealSessionFromCookie('cc5_invalid.data.here'), null);
  });

  it('roundtrips session with null optional fields', () => {
    const session = {
      sessionId: 'sid-nulls',
      user: { id: 'uid-nulls', username: null },
      accessToken: 'at-nulls',
      refreshToken: null,
      accessTokenExpiresAt: null,
      scope: null,
      tokenType: null,
    };
    const sealed = cookieSession.sealSessionToCookie(session);
    const unsealed = cookieSession.unsealSessionFromCookie(sealed);
    assert.deepEqual(unsealed, session);
  });
});

