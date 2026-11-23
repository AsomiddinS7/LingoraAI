// Read-only speech setup checks. Default mode never requests an Azure token,
// transcribes audio, synthesizes speech, writes files, or prints env values.
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const present = (value) => typeof value === 'string' && value.trim().length > 0;
const loopback = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const regionPattern = /^[a-z0-9-]{2,50}$/;
const provider = (value, allowed, fallback) => value === undefined ? fallback : allowed.includes(value) ? value : 'invalid';

export function safeUrl(value) {
  if (!present(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}

export function inspectSpeechConfig(env = {}, frontendEnv = {}) {
  const tokenUrl = safeUrl(env.VITE_SPEECH_TOKEN_URL);
  const key = env.AZURE_SPEECH_KEY;
  const region = env.AZURE_SPEECH_REGION;
  const frontendCredentialLeak = Object.entries(frontendEnv).some(([name, value]) => present(value) &&
    (name === 'AZURE_SPEECH_KEY' || name === 'AZURE_SPEECH_REGION' || /^VITE_.*(?:KEY|SECRET|PASSWORD|TOKEN)$/.test(name))) ||
    Object.entries(env).some(([name, value]) => /^VITE_.*(?:KEY|SECRET|PASSWORD|TOKEN)$/.test(name) && present(value));
  return {
    selected: {
      stt: provider(env.VITE_STT_PROVIDER, ['typed-input', 'browser-speech', 'local-stt', 'local-whisper', 'azure-speech'], 'typed-input'),
      tts: provider(env.VITE_TTS_PROVIDER, ['browser-synthesis', 'azure-speech'], 'browser-synthesis'),
    },
    azure: {
      keyPresent: present(key),
      // Shape checks are not authentication. Never return a key, its prefix, or its length.
      keyFormatPlausible: present(key) && /^[A-Za-z0-9+/_=-]{16,512}$/.test(key) && !/placeholder|replace|your[_-]?key/i.test(key),
      regionPresent: present(region), regionFormatValid: present(region) && regionPattern.test(region),
      tokenEndpointPresent: present(env.VITE_SPEECH_TOKEN_URL),
      tokenEndpointValid: Boolean(tokenUrl && /\/api\/speech-token$/.test(tokenUrl.pathname)),
      tokenEndpointTransportSafe: Boolean(tokenUrl && (tokenUrl.protocol === 'https:' || loopback(tokenUrl))),
      tokenEndpointPublicHttps: Boolean(tokenUrl && tokenUrl.protocol === 'https:' && !loopback(tokenUrl)),
      frontendCredentialLeak,
      credentialsAuthenticated: false,
    },
  };
}

export async function checkHealth(url, kind, { fetcher = fetch, allowRemote = false } = {}) {
  if (!url) return { status: 'invalid_endpoint' };
  if (!loopback(url) && !allowRemote) return { status: 'not_queried_remote' };
  if (url.protocol !== 'https:' && !loopback(url)) return { status: 'unsafe_transport' };
  try {
    const response = await fetcher(url, { method: 'GET', signal: AbortSignal.timeout(2000), redirect: 'error', cache: 'no-store' });
    if (!response.ok) return { status: 'http_error', httpStatus: response.status };
    const value = await response.json();
    if (kind === 'broker') return typeof value?.speech_configured === 'boolean' && value.ok === true
      ? { status: 'reachable', speechConfigured: value.speech_configured } : { status: 'unexpected_service' };
    if (value?.ok !== true || !['faster-whisper', 'nvidia-ctc'].includes(value.provider) || typeof value.ready !== 'boolean') return { status: 'unexpected_service' };
    return { status: 'reachable', ready: value.ready, loading: value.loading === true, busy: value.busy === true,
      loadFailed: value.load_failed === true, supportsUzbek: Array.isArray(value.languages) && value.languages.includes('uz') };
  } catch (error) {
    // Error messages, URLs, headers and server response bodies may contain secrets.
    return { status: error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  }
}

export async function checkSpeechReadiness({ env = {}, frontendEnv = {}, fetcher = fetch, live = false, origin } = {}) {
  const result = inspectSpeechConfig(env, frontendEnv);
  const tokenUrl = safeUrl(env.VITE_SPEECH_TOKEN_URL);
  const brokerUrl = tokenUrl ? new URL(tokenUrl) : new URL('http://127.0.0.1:8787/api/speech-token');
  brokerUrl.pathname = brokerUrl.pathname.replace(/speech-token$/, 'health');
  const localUrl = safeUrl(env.VITE_LOCAL_STT_URL ?? 'http://127.0.0.1:8790');
  if (localUrl) localUrl.pathname = localUrl.pathname.replace(/\/$/, '') + '/api/health';
  const [broker, localWhisper] = await Promise.all([
    checkHealth(brokerUrl, 'broker', { fetcher, allowRemote: live }),
    checkHealth(localUrl, 'whisper', { fetcher }),
  ]);
  result.health = { broker, localWhisper };
  result.browserVoices = { status: 'not_queried', uzbekVoiceAvailable: null };
  result.azureLive = { status: 'not_requested', validates: 'authorization only; not STT/TTS quality or playback' };
  if (live) {
    const configured = broker.speechConfigured === true ||
      (result.azure.keyFormatPlausible && result.azure.regionFormatValid);
    const originUrl = safeUrl(origin ?? env.SPEECH_PUBLIC_ORIGIN ?? 'http://localhost:8787');
    if (!configured || !result.azure.tokenEndpointValid || !result.azure.tokenEndpointTransportSafe ||
      result.azure.frontendCredentialLeak || !originUrl || originUrl.pathname !== '/') {
      result.azureLive.status = 'blocked_incomplete_or_unsafe_configuration';
    } else {
      try {
        const response = await fetcher(tokenUrl, { method: 'GET', headers: { Origin: originUrl.origin },
          signal: AbortSignal.timeout(10000), redirect: 'error', cache: 'no-store' });
        if (!response.ok) result.azureLive = { status: 'http_error', httpStatus: response.status };
        else {
          const value = await response.json();
          const valid = typeof value?.token === 'string' && value.token.length >= 16 && !value.token.startsWith('mock') &&
            typeof value.region === 'string' && regionPattern.test(value.region) &&
            Number.isFinite(value.expires_in_s) && value.expires_in_s >= 60 && value.expires_in_s <= 600;
          result.azure.credentialsAuthenticated = valid;
          result.azureLive.status = valid ? 'authorized_token_received_and_discarded' : 'invalid_token_response';
        }
      } catch { result.azureLive.status = 'request_failed'; }
    }
  }
  result.notes = [
    'Presence and format do not prove credentials, resource-region compatibility, speech accuracy, or audible playback.',
    'Default checks perform GET requests only to loopback health endpoints; Azure authorization requires --live.',
    'Browser STT and local Whisper need no Azure key. Browser TTS needs a matching voice in the browser runtime.',
  ];
  return result;
}

export async function queryBrowserVoices(channel = 'chrome') {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ channel, headless: true });
    const page = await browser.newPage();
    return await page.evaluate(async () => {
      if (!('speechSynthesis' in window)) return { status: 'unsupported', uzbekVoiceAvailable: false };
      const synth = window.speechSynthesis;
      if (!synth.getVoices().length) await new Promise((resolve) => {
        const timer = setTimeout(done, 2000);
        function done() { clearTimeout(timer); synth.removeEventListener('voiceschanged', done); resolve(); }
        synth.addEventListener('voiceschanged', done);
      });
      const voices = synth.getVoices();
      const uzbek = voices.filter((voice) => /^uz(?:-|$)/i.test(voice.lang));
      return { status: 'queried', scope: 'headless browser runtime; other profiles/devices may differ', totalVoiceCount: voices.length,
        uzbekVoiceAvailable: uzbek.length > 0, uzbekVoices: uzbek.map(({ name, lang, localService }) => ({ name, lang, localService })) };
    });
  } catch { return { status: 'browser_query_failed', uzbekVoiceAvailable: null }; }
  finally { await browser?.close(); }
}

async function readEnvironment(path) {
  try { return { present: true, readable: true, values: parseEnv(await readFile(path, 'utf8')) }; }
  catch (error) { return { present: error?.code !== 'ENOENT', readable: false, values: {} }; }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/check-speech-readiness.mjs [--browser-voices] [--channel chrome|msedge] [--live] [--origin https://frontend.example]');
    return;
  }
  const [server, frontend] = await Promise.all([readEnvironment(resolve('.env.speech')), readEnvironment(resolve('.env.local'))]);
  const env = { ...server.values, ...frontend.values, ...process.env };
  const origin = args.includes('--origin') ? args[args.indexOf('--origin') + 1] : undefined;
  const report = await checkSpeechReadiness({ env, frontendEnv: frontend.values, live: args.includes('--live'), origin });
  report.files = { serverEnvPresent: server.present, serverEnvReadable: server.readable, frontendEnvPresent: frontend.present, frontendEnvReadable: frontend.readable };
  if (args.includes('--browser-voices')) report.browserVoices = await queryBrowserVoices(args.includes('--channel') ? args[args.indexOf('--channel') + 1] : 'chrome');
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Speech readiness diagnostic failed; no credential values were logged.'); process.exitCode = 1; });
}
