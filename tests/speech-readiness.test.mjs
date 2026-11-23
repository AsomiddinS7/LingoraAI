import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectSpeechConfig, checkHealth, checkSpeechReadiness } from '../scripts/check-speech-readiness.mjs';

const configured = () => ({ AZURE_SPEECH_KEY: 'a'.repeat(32), AZURE_SPEECH_REGION: 'westeurope',
  VITE_SPEECH_TOKEN_URL: 'http://localhost:8787/api/speech-token', VITE_STT_PROVIDER: 'azure-speech', VITE_TTS_PROVIDER: 'azure-speech' });
const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
const healthy = (url) => response(String(url).includes(':8790')
  ? { ok: true, provider: 'faster-whisper', ready: true, loading: false, busy: false, load_failed: false, languages: ['uz'] }
  : { ok: true, speech_configured: true });

test('missing Azure configuration stays explicitly unauthenticated without claiming browser voices absent', () => {
  const report = inspectSpeechConfig();
  assert.equal(report.azure.keyPresent, false);
  assert.equal(report.azure.regionPresent, false);
  assert.equal(report.azure.tokenEndpointPresent, false);
  assert.equal(report.azure.credentialsAuthenticated, false);
  assert.equal(report.selected.stt, 'typed-input');
});

test('invalid region, credential-bearing URL and accidental frontend key are detected without values', () => {
  const secret = 'NeverLogThisPrivateCredential123';
  const env = { ...configured(), AZURE_SPEECH_REGION: 'West Europe!', VITE_SPEECH_TOKEN_URL: `https://name:${secret}@example.com/api/speech-token`, VITE_AZURE_SPEECH_KEY: secret };
  const report = inspectSpeechConfig(env, { AZURE_SPEECH_KEY: secret });
  assert.equal(report.azure.regionFormatValid, false);
  assert.equal(report.azure.tokenEndpointValid, false);
  assert.equal(report.azure.frontendCredentialLeak, true);
  assert.equal(JSON.stringify(report).includes(secret), false);
  assert.equal(JSON.stringify(report).includes('West Europe!'), false);
});

test('public deployment requires HTTPS rather than a localhost-only broker', () => {
  assert.equal(inspectSpeechConfig(configured()).azure.tokenEndpointPublicHttps, false);
  assert.equal(inspectSpeechConfig({ ...configured(), VITE_SPEECH_TOKEN_URL: 'https://broker.example/api/speech-token' }).azure.tokenEndpointPublicHttps, true);
  assert.equal(inspectSpeechConfig({ ...configured(), VITE_SPEECH_TOKEN_URL: 'http://broker.example/api/speech-token' }).azure.tokenEndpointTransportSafe, false);
});

test('credential format checks reject short keys and placeholders while never claiming authentication', () => {
  for (const key of ['short', 'your_key_placeholder_replace_me', 'contains spaces in a credential']) {
    const result = inspectSpeechConfig({ ...configured(), AZURE_SPEECH_KEY: key });
    assert.equal(result.azure.keyPresent, true);
    assert.equal(result.azure.keyFormatPlausible, false);
    assert.equal(result.azure.credentialsAuthenticated, false);
  }
  assert.equal(inspectSpeechConfig(configured()).azure.keyFormatPlausible, true);
});

test('default checks only loopback GET health; even configured Azure never fetches a token', async () => {
  const calls = [];
  const report = await checkSpeechReadiness({ env: configured(), fetcher: async (url, options) => { calls.push([String(url), options.method]); return healthy(url); } });
  assert.deepEqual(calls.map(([, method]) => method), ['GET', 'GET']);
  assert(calls.every(([url]) => url.endsWith('/api/health')));
  assert.equal(report.azureLive.status, 'not_requested');
  assert.equal(report.azure.credentialsAuthenticated, false);
  assert.equal(report.browserVoices.status, 'not_queried');
  assert.equal(report.browserVoices.uzbekVoiceAvailable, null);
  assert.equal(report.health.localWhisper.ready, true);
});

test('local health distinguishes unready, failed, busy and wrong service responses', async () => {
  const url = new URL('http://127.0.0.1:8790/api/health');
  const notReady = await checkHealth(url, 'whisper', { fetcher: async () => response({ ok: true, provider: 'faster-whisper', ready: false, loading: true, busy: true, load_failed: true, languages: ['en'] }) });
  assert.deepEqual(notReady, { status: 'reachable', ready: false, loading: true, busy: true, loadFailed: true, supportsUzbek: false });
  assert.equal((await checkHealth(url, 'whisper', { fetcher: async () => response({ ok: true }) })).status, 'unexpected_service');
});

test('generic local STT selection accepts the NVIDIA backend and retains its readiness checks', async () => {
  const config = inspectSpeechConfig({ VITE_STT_PROVIDER: 'local-stt', VITE_LOCAL_STT_URL: 'http://127.0.0.1:8791' });
  assert.equal(config.selected.stt, 'local-stt');
  const result = await checkHealth(new URL('http://127.0.0.1:8791/api/health'), 'whisper', {
    fetcher: async () => response({ ok: true, provider: 'nvidia-ctc', ready: true, languages: ['uz'] }),
  });
  assert.equal(result.status, 'reachable');
  assert.equal(result.ready, true);
  assert.equal(result.supportsUzbek, true);
});

test('remote health is not contacted by default and network errors cannot leak secrets', async () => {
  let called = false;
  assert.equal((await checkHealth(new URL('https://example.com/api/health'), 'broker', { fetcher: async () => { called = true; } })).status, 'not_queried_remote');
  assert.equal(called, false);
  const report = await checkSpeechReadiness({ env: configured(), fetcher: async () => { throw new Error('PRIVATE_HEADER_TOKEN'); } });
  assert.equal(report.health.broker.status, 'unreachable');
  assert.equal(JSON.stringify(report).includes('PRIVATE_HEADER_TOKEN'), false);
});

test('explicit live check validates and discards broker token without logging it', async () => {
  const token = 'PRIVATE_AZURE_BROKER_AUTH_TOKEN'; const calls = [];
  const report = await checkSpeechReadiness({ env: configured(), live: true, fetcher: async (url, options) => {
    calls.push({ url: String(url), method: options.method });
    return String(url).endsWith('/api/speech-token') ? response({ token, region: 'westeurope', expires_in_s: 540 }) : healthy(url);
  } });
  assert.equal(calls.filter((call) => call.url.endsWith('/api/speech-token')).length, 1);
  assert.equal(report.azure.credentialsAuthenticated, true);
  assert.equal(report.azureLive.status, 'authorized_token_received_and_discarded');
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal(JSON.stringify(report).includes(configured().AZURE_SPEECH_KEY), false);
});

test('explicit live mode still blocks unsafe or unconfigured broker and rejects mock token', async () => {
  let tokenCalls = 0;
  const fetcher = async (url) => { if (String(url).endsWith('/api/speech-token')) tokenCalls++; return response({ ok: true, speech_configured: false }); };
  const missing = await checkSpeechReadiness({ env: { VITE_SPEECH_TOKEN_URL: 'http://localhost:8787/api/speech-token' }, live: true, fetcher });
  assert.equal(missing.azureLive.status, 'blocked_incomplete_or_unsafe_configuration');
  assert.equal(tokenCalls, 0);
  const mocked = await checkSpeechReadiness({ env: configured(), live: true, fetcher: async (url) => String(url).endsWith('/api/speech-token')
    ? response({ token: 'mock-token-is-never-real-authorization', region: 'westeurope', expires_in_s: 540 }) : healthy(url) });
  assert.equal(mocked.azure.credentialsAuthenticated, false);
  assert.equal(mocked.azureLive.status, 'invalid_token_response');
});
