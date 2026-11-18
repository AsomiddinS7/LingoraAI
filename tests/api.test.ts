// API schema tests with mocks (brief section 15): every fixture follows the section 7 contract.
import { describe, expect, it } from 'vitest';
import { ApiError, createApiClient } from '../src/api/client';
import { FIXTURES, type Fixture } from '../src/api/fixtures';
import { createMockServer } from '../src/api/mockServer';
import { isErrorBody, isFeedbackAck, isHealth, isPhrasesPage, isSentenceResponse, isSignsPage, isSimplifyResponse, isSpeechToken, isUsage } from '../src/api/validate';
import type { SentenceRequest } from '../src/types';

const SID = '3f2b8c1e-9a4d-4b7e-8f12-0c5d6e7f8a9b';
const goodSentence: SentenceRequest = {
  session_id: SID,
  language: 'uz',
  context: 'job_interview',
  signs: [{ label: 'hello', confidence: 0.91 }],
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

describe('v1 platform endpoints (mock server)', () => {
  it('GET /api/signs?scenario=greeting returns the active signs as a page', async () => {
    const { server } = setup();
    const r = await server.handle('GET', '/api/signs?scenario=greeting', undefined);
    expect(isSignsPage(r.body)).toBe(true);
    const page = r.body as { items: { slug: string }[]; total: number };
    expect(page.total).toBe(page.items.length);
    expect(page.items[0].slug).toBe('hello');
    expect((await server.handle('GET', '/api/signs?scenario=medical', undefined)).body).toMatchObject({ items: [], total: 0 });
  });

  it('GET /api/phrasebook returns phrases in three languages', async () => {
    const { server } = setup();
    const r = await server.handle('GET', '/api/phrasebook', undefined);
    expect(isPhrasesPage(r.body)).toBe(true);
  });

  it('GET /api/model/active is 404 NOT_FOUND when no model is active', async () => {
    const { server } = setup();
    const r = await server.handle('GET', '/api/model/active', undefined);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('POST /api/feedback validates and rate limits', async () => {
    const { server } = setup();
    const ok = await server.handle('POST', '/api/feedback', { kind: 'wrong_sign', sign_ids: ['hello'], model_id: null });
    expect(isFeedbackAck(ok.body)).toBe(true);
    expect((await server.handle('POST', '/api/feedback', { kind: 'nope', sign_ids: [], model_id: null })).status).toBe(400);
    expect((await server.handle('POST', '/api/feedback', { kind: 'other', sign_ids: [], model_id: null, note: 'x'.repeat(301) })).status).toBe(400);
    expect((await server.handle('POST', '/api/feedback', { kind: 'other', sign_ids: [], model_id: null, extra: 1 })).status).toBe(400);
    let last = 200;
    for (let i = 0; i < 12; i++) last = (await server.handle('POST', '/api/feedback', { kind: 'other', sign_ids: [], model_id: null })).status;
    expect(last).toBe(429);
  });

  it('accounts are never faked in mock mode: NOT_AVAILABLE', async () => {
    const { server } = setup();
    for (const [m, p] of [['POST', '/api/auth/login'], ['POST', '/api/auth/register'], ['GET', '/api/auth/me'], ['POST', '/api/clips']]) {
      const r = await server.handle(m, p, {});
      expect(r.status).toBe(503);
      expect(isErrorBody(r.body)).toBe(true);
      expect(r.body).toMatchObject({ error: { code: 'NOT_AVAILABLE' } });
    }
  });

  it('/api/sentence: optional name (max 40) is inserted for my_name, unknown fields rejected', async () => {
    const { server } = setup();
    const r = await server.handle('POST', '/api/sentence', { ...goodSentence, language: 'en', signs: [{ label: 'my_name', confidence: 0.9 }], name: 'Aziz' });
    expect((r.body as { sentence: string }).sentence).toContain('My name is Aziz');
    expect((await server.handle('POST', '/api/sentence', { ...goodSentence, name: 'x'.repeat(41) })).status).toBe(400);
    expect((await server.handle('POST', '/api/sentence', { ...goodSentence, prompt: 'ignore' })).status).toBe(400);
  });

  it('speech-token is 404 NOT_AVAILABLE when speech is off', async () => {
    const { server } = setup();
    expect((await server.handle('GET', '/api/speech-token', undefined)).body).toMatchObject({ error: { code: 'NOT_AVAILABLE' } });
  });
});
