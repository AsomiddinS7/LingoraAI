// Minimal token broker for the MVP. It receives no microphone audio or conversation text.
// Run: node --env-file=.env.speech scripts/speech-server.mjs (Node 22+).
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const inside = (root, path) => {
  const rel = relative(root, path);
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
};

function publicOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return null;
    return url;
  } catch { return null; }
}

/** Root is always the project's build directory, including when served behind a proxy. */
async function serveStatic(request, response, path, fs = { readFile, realpath, stat }) {
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { return 400; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some((part) => part === '..' || part.startsWith('.'))) return 403;
  const candidate = resolve(DIST_DIR, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!inside(DIST_DIR, candidate)) return 403;
  let actual;
  try {
    const root = await fs.realpath(DIST_DIR);
    actual = await fs.realpath(candidate);
    // Realpath validation prevents a symlink in dist escaping the served directory.
    if (!inside(root, actual)) return 403;
    const info = await fs.stat(actual);
    if (!info.isFile()) return 404;
    const extension = /\.[^.\\/]+$/.exec(actual)?.[0]?.toLowerCase();
    response.setHeader('Content-Type', MIME[extension] ?? 'application/octet-stream');
    response.setHeader('Content-Length', info.size);
    response.setHeader('Cache-Control', 'no-cache');
    if (request.method === 'HEAD') { response.writeHead(200); response.end(); return null; }
    const bytes = await fs.readFile(actual);
    response.writeHead(200);
    response.end(bytes);
    return null;
  } catch { return 404; }
}

export function createSpeechServer({ env = process.env, fetchImpl = fetch, now = Date.now, staticFs } = {}) {
  const region = env.AZURE_SPEECH_REGION ?? '';
  const key = env.AZURE_SPEECH_KEY ?? '';
  const origins = new Set((env.SPEECH_ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173')
    .split(',').map((s) => s.trim()).filter(Boolean));
  const ownOrigin = publicOrigin(env.SPEECH_PUBLIC_ORIGIN);
  if (ownOrigin) origins.add(ownOrigin.origin);
  const configured = Boolean(key && /^[a-z0-9-]{2,50}$/.test(region));
  let token = null;
  let pending = null;
  const rates = new Map();

  const issue = async () => {
    if (token && token.expiresAt > now()) return token;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetchImpl(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': key }, body: '',
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error('upstream');
      const value = (await response.text()).trim();
      if (value.length < 16 || value.length > 20000) throw new Error('upstream');
      // Azure tokens last 10 minutes. Advertise at most 9 minutes, and subtract cache age.
      token = { value, expiresAt: now() + 540000 };
      return token;
    })();
    try { return await pending; } finally { pending = null; }
  };

  return http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    const send = (status, body) => { response.writeHead(status); response.end(JSON.stringify(body)); };
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) return send(403, { error: { code: 'FORBIDDEN', message: 'Origin not allowed' } });
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    let path;
    try { path = new URL(request.url ?? '/', 'http://localhost').pathname; }
    catch { return send(400, { error: { code: 'BAD_REQUEST', message: 'Invalid URL' } }); }
    if (request.method === 'OPTIONS') {
      if (!origin || path !== '/api/speech-token') return send(403, { error: { code: 'FORBIDDEN', message: 'Origin required' } });
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && path === '/api/health') return send(200, { ok: true, speech_configured: configured });
    if (path !== '/api/speech-token') {
      if (env.SPEECH_SERVE_DIST === 'true' && !path.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)) {
        const status = await serveStatic(request, response, path, staticFs);
        if (status === null) return;
        // serveStatic may have populated headers before a file read failed.
        response.removeHeader('Content-Length');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        return send(status, { error: { code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', message: 'File unavailable' } });
      }
      return send(404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    if (request.method !== 'GET') return send(405, { error: { code: 'BAD_REQUEST', message: 'Use GET' } });
    // Same-origin GETs usually omit Origin. Fetch Metadata + an explicit public host
    // permits those calls without trusting X-Forwarded-Host supplied by the client.
    const sameOrigin = ownOrigin && request.headers['sec-fetch-site'] === 'same-origin' &&
      request.headers.host?.toLowerCase() === ownOrigin.host.toLowerCase();
    if (!origin && !sameOrigin) return send(403, { error: { code: 'FORBIDDEN', message: 'Origin required' } });
    if (!configured) return send(503, { error: { code: 'NOT_AVAILABLE', message: 'Speech is not configured' } });
    // Trust socket IP only; forwarding headers are user-controlled without a configured proxy.
    const address = request.socket.remoteAddress ?? 'unknown';
    const time = now();
    if (rates.size > 1000) for (const [ip, rate] of rates) if (time >= rate.reset) rates.delete(ip);
    const rate = rates.get(address) ?? { count: 0, reset: time + 60000 };
    if (time >= rate.reset) { rate.count = 0; rate.reset = time + 60000; }
    rates.set(address, rate);
    if (++rate.count > 10) {
      response.setHeader('Retry-After', '60');
      return send(429, { error: { code: 'RATE_LIMITED', message: 'Try again later', retry_after_s: 60 } });
    }
    try {
      const issued = await issue();
      const seconds = Math.floor((issued.expiresAt - now()) / 1000);
      // Do not hand a nearly expired cached token to a new recognition turn.
      if (seconds < 60) { token = null; const fresh = await issue(); return send(200, { token: fresh.value, region, expires_in_s: 540 }); }
      return send(200, { token: issued.value, region, expires_in_s: seconds });
    } catch {
      return send(502, { error: { code: 'UPSTREAM_ERROR', message: 'Speech authorization unavailable' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.SPEECH_PORT ?? process.env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid speech server port');
  createSpeechServer().listen(port, process.env.SPEECH_HOST ?? '127.0.0.1', () => {
    console.log(`Lingora speech token server listening on port ${port}`);
  });
}
