// Run separately from Vitest: node --test tests/speech-server.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import http from 'node:http';
import { createSpeechServer } from '../scripts/speech-server.mjs';

const origin = 'http://localhost:5173';
const fixtureToken = 'test-authorization-token-value';

async function harness(options = {}) {
  let calls = 0;
  let time = 0;
  const env = {
    AZURE_SPEECH_KEY: 'test-key-not-real', AZURE_SPEECH_REGION: 'westeurope',
    SPEECH_ALLOWED_ORIGINS: origin, SPEECH_PUBLIC_ORIGIN: 'https://lingora.test',
    ...options.env,
  };
  const server = createSpeechServer({
    env, now: () => time,
    fetchImpl: async (...args) => {
      calls++;
      return options.fetchImpl ? options.fetchImpl(...args) : new Response(fixtureToken);
    },
    staticFs: options.staticFs,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    request: (path, init) => fetch(base + path, init),
    token: (headers = { Origin: origin }) => fetch(base + '/api/speech-token', { headers }),
    rawToken: (headers) => new Promise((resolve, reject) => {
      // Node fetch rewrites Host. A raw request models the exact proxy/browser headers.
      const request = http.get(base + '/api/speech-token', { headers }, (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
      });
      request.on('error', reject);
    }),
    calls: () => calls,
    time: (value) => { time = value; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('permits allowed cross-origin requests and keeps tokens out of caches', async () => {
  const h = await harness();
  try {
    const response = await h.token();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { token: fixtureToken, region: 'westeurope', expires_in_s: 540 });
  } finally { await h.close(); }
});

test('permits same-origin GET without Origin only with configured Host and Fetch Metadata', async () => {
  const h = await harness();
  try {
    const response = await h.rawToken({ Host: 'lingora.test', 'Sec-Fetch-Site': 'same-origin' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await h.rawToken({ Host: 'other.test', 'Sec-Fetch-Site': 'same-origin' })).status, 403);
    assert.equal((await h.rawToken({ Host: 'lingora.test', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await h.rawToken({ Host: 'lingora.test' })).status, 403);
    assert.equal((await h.rawToken({})).status, 403);
    assert.equal((await h.rawToken({ Origin: 'https://attacker.test', Host: 'lingora.test', 'Sec-Fetch-Site': 'same-origin' })).status, 403);
  } finally { await h.close(); }
});

test('refuses missing or invalid public origin for originless requests', async () => {
  for (const value of ['', 'https://lingora.test/untrusted/path', 'javascript:alert(1)']) {
    const h = await harness({ env: { SPEECH_PUBLIC_ORIGIN: value } });
    try { assert.equal((await h.token({ Host: 'lingora.test', 'Sec-Fetch-Site': 'same-origin' })).status, 403); }
    finally { await h.close(); }
  }
});

test('caches token issuance, subtracts cache age, and refreshes before expiry', async () => {
  const h = await harness();
  try {
    await Promise.all([h.token(), h.token()]);
    assert.equal(h.calls(), 1);
    h.time(120000);
    assert.equal((await (await h.token()).json()).expires_in_s, 420);
    assert.equal(h.calls(), 1);
    h.time(500000);
    assert.equal((await (await h.token()).json()).expires_in_s, 540);
    assert.equal(h.calls(), 2);
  } finally { await h.close(); }
});

test('reports missing configuration and sanitizes upstream failures', async () => {
  const missing = await harness({ env: { AZURE_SPEECH_KEY: '' } });
  try {
    assert.equal((await missing.token()).status, 503);
    assert.deepEqual(await (await missing.request('/api/health')).json(), { ok: true, speech_configured: false });
  } finally { await missing.close(); }
  const upstream = await harness({ fetchImpl: async () => { throw new Error('secret upstream message'); } });
  try {
    const response = await upstream.token();
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes('secret'), false);
  } finally { await upstream.close(); }
});

test('rate limits by socket, and does not trust X-Forwarded-For', async () => {
  const h = await harness();
  try {
    for (let i = 0; i < 10; i++) assert.equal((await h.token()).status, 200);
    const response = await h.token({ Origin: origin, 'X-Forwarded-For': '203.0.113.1' });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    h.time(60001);
    assert.equal((await h.token()).status, 200);
  } finally { await h.close(); }
});

function staticFixture() {
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  const files = new Map([
    ['index.html', '<html>Lingora</html>'], ['assets/app.js', 'export const ready = true;'],
    ['mediapipe/wasm/tasks.wasm', 'wasm-fixture'], ['model/hand_landmarker.task', 'model-fixture'],
    ['model/vocabulary.json', '{}'], ['icons/icon.svg', '<svg/>'],
  ].map(([path, content]) => [resolve(root, path), Buffer.from(content)]));
  const outside = resolve(root, '..', 'private.env');
  const symlink = resolve(root, 'leak.txt');
  return {
    realpath: async (path) => {
      if (path === symlink) return outside;
      if (path === root || files.has(path)) return path;
      throw new Error('ENOENT');
    },
    stat: async (path) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return { isFile: () => true, size: files.get(path).byteLength };
    },
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('ENOENT');
      return files.get(path);
    },
  };
}

test('serves the fixed dist directory with correct MIME for browser ML assets', async () => {
  const h = await harness({ env: { SPEECH_SERVE_DIST: 'true' }, staticFs: staticFixture() });
  try {
    for (const [path, mime] of [
      ['/', 'text/html; charset=utf-8'], ['/assets/app.js', 'text/javascript; charset=utf-8'],
      ['/mediapipe/wasm/tasks.wasm', 'application/wasm'], ['/model/hand_landmarker.task', 'application/octet-stream'],
      ['/model/vocabulary.json', 'application/json; charset=utf-8'], ['/icons/icon.svg', 'image/svg+xml'],
    ]) {
      const response = await h.request(path);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get('content-type'), mime, path);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    const head = await h.request('/', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal((await head.text()).length, 0);
  } finally { await h.close(); }
});

test('rejects traversal, dotfiles, backslashes, symlink escapes, and missing asset paths', async () => {
  const h = await harness({ env: { SPEECH_SERVE_DIST: 'true' }, staticFs: staticFixture() });
  try {
    for (const path of ['/%2e%2e%2fprivate.env', '/assets%5c..%5cprivate.env', '/.env', '/leak.txt', '/%00']) {
      assert.equal((await h.request(path)).status, 403, path);
    }
    assert.equal((await h.request('/model/missing.task')).status, 404);
    assert.equal((await h.request('/api/unknown')).status, 404);
    assert.equal((await h.request('/%ZZ')).status, 400);
  } finally { await h.close(); }
});

test('static files remain unavailable unless explicitly enabled', async () => {
  const h = await harness({ staticFs: staticFixture() });
  try { assert.equal((await h.request('/')).status, 404); }
  finally { await h.close(); }
});
