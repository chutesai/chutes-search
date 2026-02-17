const assert = require('node:assert');
const { describe, it, beforeEach, after } = require('node:test');

const sandy = require('./sandy.ts');

describe('sandy client', () => {
  const OLD_ENV = process.env;
  const OLD_FETCH = global.fetch;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  after(() => {
    process.env = OLD_ENV;
    global.fetch = OLD_FETCH;
  });

  it('throws when SANDY_BASE_URL is missing', async () => {
    delete process.env.SANDY_BASE_URL;
    process.env.SANDY_API_KEY = 'test-key';
    await assert.rejects(
      () => sandy.sandyRequest('/api/sandboxes', { method: 'GET' }, { retries: 0 }),
      /SANDY_BASE_URL is not configured/,
    );
  });

  it('uses normalized base URL and auth header', async () => {
    process.env.SANDY_BASE_URL = 'https://sandy.example.com///';
    process.env.SANDY_API_KEY = 'secret-key';

    global.fetch = async (url, options) => {
      assert.equal(url, 'https://sandy.example.com/api/ping');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.get('Authorization'), 'Bearer secret-key');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await sandy.sandyRequest('/api/ping', { method: 'GET' }, { retries: 0 });
    assert.deepEqual(result, { ok: true });
  });

  it('retries transient 502 errors and eventually succeeds', async () => {
    process.env.SANDY_BASE_URL = 'https://sandy.example.com';

    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      if (callCount < 3) {
        return new Response('Upstream error', { status: 502 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const result = await sandy.sandyRequest(
      '/api/retry',
      { method: 'GET' },
      { retries: 2, retryDelayMs: 0, timeoutMs: 1000 },
    );
    assert.equal(callCount, 3);
    assert.deepEqual(result, { ok: true });
  });

  it('does not retry non-retriable 400 responses', async () => {
    process.env.SANDY_BASE_URL = 'https://sandy.example.com';

    let callCount = 0;
    global.fetch = async () => {
      callCount += 1;
      return new Response('bad request', { status: 400 });
    };

    await assert.rejects(
      () =>
        sandy.sandyRequest(
          '/api/non-retriable',
          { method: 'POST' },
          { retries: 3, retryDelayMs: 0, timeoutMs: 1000 },
        ),
      /Sandy API error 400/,
    );
    assert.equal(callCount, 1);
  });

  it('createSandbox sends expected defaults', async () => {
    process.env.SANDY_BASE_URL = 'https://sandy.example.com';
    process.env.SANDY_API_KEY = 'abc123';

    global.fetch = async (url, options) => {
      assert.equal(url, 'https://sandy.example.com/api/sandboxes');
      assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body);
      assert.deepEqual(payload, {
        priority: 1,
        preemptable: false,
        flavor: 'agent-ready',
      });
      return new Response(JSON.stringify({ sandboxId: 'sbx-1' }), { status: 200 });
    };

    const sandbox = await sandy.createSandbox();
    assert.equal(sandbox.sandboxId, 'sbx-1');
  });

  it('execInSandbox sanitizes control characters before sending', async () => {
    process.env.SANDY_BASE_URL = 'https://sandy.example.com';

    let payload;
    global.fetch = async (_url, options) => {
      payload = JSON.parse(options.body);
      return new Response(
        JSON.stringify({ stdout: 'ok', stderr: '', exitCode: 0 }),
        { status: 200 },
      );
    };

    await sandy.execInSandbox('sandbox-1', 'echo hi\u0000\u0007', { DEMO: '1' }, 1234);
    assert.equal(payload.command, 'echo hi');
    assert.equal(payload.cwd, '/workspace');
    assert.equal(payload.timeoutMs, 1234);
    assert.deepEqual(payload.env, { DEMO: '1' });
  });
});
