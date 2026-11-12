// API schema tests with mocks (brief section 15): every fixture follows the section 7 contract.
import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from '../src/api/client';
import { FIXTURES, type Fixture } from '../src/api/fixtures';
import { createMockServer } from '../src/api/mockServer';
import { isErrorBody, isHealth, isSentenceResponse, isSimplifyResponse, isSpeechToken, isUsage } from '../src/api/validate';
import type { SentenceRequest } from '../src/types';

const SID = '3f2b8c1e-9a4d-4b7e-8f12-0c5d6e7f8a9b';
const goodSentence: SentenceRequest = {
  session_id: SID,
  language: 'uz',
  context: 'job_interview',
  signs: [{ label: 'i_want_work', confidence: 0.91 }],
  face_hints: { question: false, negation: false },
};

function setup(fixture: Fixture = 'success', speechTokenEnabled = false) {
  const settings = { fixture, speechTokenEnabled };
  const server = createMockServer({ getSettings: () => settings, delayMs: () => 0 });
  return { server, settings };
}

describe('mock server follows the contract', () => {
  it('returns a success sentence in each language, marked [PLACEHOLDER]', async () => {
    const { server } = setup();
    for (const language of ['uz', 'ru', 'en'] as const) {
      const r = await server.handle('POST', '/api/sentence', { ...goodSentence, language });
      expect(r.status).toBe(200);
      expect(isSentenceResponse(r.body)).toBe(true);
      const body = r.body as { status: string; sentence: string; language: string };
      expect(body.status).toBe('ok');
      expect(body.language).toBe(language);
      expect(body.sentence).toContain('[PLACEHOLDER]');
    }
  });

  it('accepts face_hints = null', async () => {
    const { server } = setup();
    const r = await server.handle('POST', '/api/sentence', { ...goodSentence, face_hints: null });
    expect(r.status).toBe(200);
  });

  it('refusal fixture has needs_human true and a null sentence', async () => {
    const { server } = setup('refused');
    const r = await server.handle('POST', '/api/sentence', goodSentence);
    expect(isSentenceResponse(r.body)).toBe(true);
    expect(r.body).toMatchObject({ status: 'refused', sentence: null, needs_human: true });
  });

  it.each([
    ['no signs', { ...goodSentence, signs: [] }],
    ['six signs', { ...goodSentence, signs: Array(6).fill({ label: 'yes', confidence: 0.9 }) }],
    ['unknown label', { ...goodSentence, signs: [{ label: 'not_a_sign', confidence: 0.9 }] }],
    ['confidence > 1', { ...goodSentence, signs: [{ label: 'yes', confidence: 1.2 }] }],
    ['bad language', { ...goodSentence, language: 'de' }],
    ['bad session id', { ...goodSentence, session_id: 'abc' }],
    ['bad face hints', { ...goodSentence, face_hints: { question: 'yes' } }],
  ])('rejects %s with BAD_REQUEST', async (_name, body) => {
    const { server } = setup();
    const r = await server.handle('POST', '/api/sentence', body);
    expect(r.status).toBe(400);
    expect(isErrorBody(r.body)).toBe(true);
    expect((r.body as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });

  it('every error fixture uses the shared error shape', async () => {
    for (const fixture of ['validation_error', 'upstream_error', 'rate_limited', 'cap_reached'] as Fixture[]) {
      const { server } = setup(fixture);
      const r = await server.handle('POST', '/api/sentence', goodSentence);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(isErrorBody(r.body)).toBe(true);
    }
  });

  it('rate limit carries retry_after_s', async () => {
    const { server } = setup('rate_limited');
    const r = await server.handle('POST', '/api/sentence', goodSentence);
    expect(r.body).toMatchObject({ error: { code: 'RATE_LIMITED', retry_after_s: 10 } });
  });

  it('simplify: ok shape, 300 character limit, refusal', async () => {
    const { server, settings } = setup();
    const ok = await server.handle('POST', '/api/simplify', { session_id: SID, language: 'en', text: 'Could you please repeat what you just said about the job?' });
    expect(isSimplifyResponse(ok.body)).toBe(true);
    const tooLong = await server.handle('POST', '/api/simplify', { session_id: SID, language: 'en', text: 'x'.repeat(301) });
    expect(tooLong.status).toBe(400);
    settings.fixture = 'refused';
    const refused = await server.handle('POST', '/api/simplify', { session_id: SID, language: 'en', text: 'hello' });
    expect(isSimplifyResponse(refused.body)).toBe(true);
    expect(refused.body).toMatchObject({ status: 'refused', needs_human: true });
  });

  it('usage, health and speech-token (404 in Plan B)', async () => {
    const { server, settings } = setup();
    expect(isUsage((await server.handle('GET', '/api/usage', undefined)).body)).toBe(true);
    expect(isHealth((await server.handle('GET', '/api/health', undefined)).body)).toBe(true);
    expect((await server.handle('GET', '/api/speech-token', undefined)).status).toBe(404);
    settings.speechTokenEnabled = true;
    const tok = await server.handle('GET', '/api/speech-token', undefined);
    expect(isSpeechToken(tok.body)).toBe(true);
    expect((tok.body as { expires_in_s: number }).expires_in_s).toBe(540);
  });

  it('usage counts successful model calls', async () => {
    const { server } = setup();
    await server.handle('POST', '/api/sentence', goodSentence);
    await server.handle('POST', '/api/sentence', goodSentence);
    const u = (await server.handle('GET', '/api/usage', undefined)).body as { calls_session: number; mock: boolean };
    expect(u.calls_session).toBe(2);
    expect(u.mock).toBe(true);
  });

  it('has a fixture for every listed state', () => {
    expect(FIXTURES).toEqual(expect.arrayContaining(['success', 'refused', 'validation_error', 'timeout', 'upstream_error', 'rate_limited']));
  });
});

describe('API client: timeout, one retry, typed errors (N6)', () => {
  function client(fixture: Fixture, opts: { offline?: boolean; timeoutMs?: number } = {}) {
    const { server, settings } = setup(fixture);
    let calls = 0;
    const api = createApiClient({
      transport: () => (url, init) => {
        calls++;
        return server.fetch(url, init);
      },
      baseUrl: () => '',
      isOffline: () => !!opts.offline,
      timeoutMs: opts.timeoutMs ?? 50,
    });
    return { api, settings, calls: () => calls };
  }

  it('success goes through unchanged', async () => {
    const { api } = client('success');
    const r = await api.post('/api/sentence', goodSentence, isSentenceResponse);
    expect(r.status).toBe('ok');
  });

  it('timeout: aborts, retries once, then UPSTREAM_TIMEOUT', async () => {
    const { api, calls } = client('timeout', { timeoutMs: 30 });
    await expect(api.post('/api/sentence', goodSentence, isSentenceResponse)).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    expect(calls()).toBe(2);
  });

  it('upstream error is retried once', async () => {
    const { api, calls } = client('upstream_error');
    await expect(api.post('/api/sentence', goodSentence, isSentenceResponse)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
    expect(calls()).toBe(2);
  });

  it('rate limit is not retried and keeps retry_after_s', async () => {
    const { api, calls } = client('rate_limited');
    const err = await api.post('/api/sentence', goodSentence, isSentenceResponse).catch((e: ApiError) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('RATE_LIMITED');
    expect((err as ApiError).retryAfterS).toBe(10);
    expect(calls()).toBe(1);
  });

  it('offline fails fast without a request', async () => {
    const { api, calls } = client('success', { offline: true });
    await expect(api.post('/api/sentence', goodSentence, isSentenceResponse)).rejects.toMatchObject({ code: 'OFFLINE' });
    expect(calls()).toBe(0);
  });

  it('a response that breaks the contract becomes INVALID_RESPONSE', async () => {
    const api = createApiClient({
      transport: () => async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }),
      baseUrl: () => '',
      isOffline: () => false,
    });
    await expect(api.post('/api/sentence', goodSentence, isSentenceResponse)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
